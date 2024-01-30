import { check, fail } from 'k6';
import remote from 'k6/x/remotewrite';
import { randomIntBetween, uuidv4, randomItem } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

/**
 * URL to write to.
 * Overrides the hostname if set.
 * @constant {string}
 */
const REMOTE_WRITE_URL = __ENV.REMOTE_WRITE_URL || 'http://localhost:9090/api/v1/write';

/**
 * Number of remote write requests to send every SCRAPE_INTERVAL_SECONDS.
 * @constant {number}
 */
const WRITE_REQUEST_RATE = parseInt(__ENV.WRITE_REQUEST_RATE || 1);

/**
 * Duration of the load test in minutes (including ramp up and down).
 * @constant {number}
 */

const DURATION_MIN = parseInt(__ENV.DURATION_MINUTES || (12*60));
/**
 * Duration of the ramp up period in minutes.
 * @constant {number}
 */
const RAMP_UP_MIN = parseInt(__ENV.RAMP_UP_MINUTES || 0);
/**
 * Duration of the ramp down period in minutes.
 * @constant {number}
 */
const RAMP_DOWN_MIN = parseInt(__ENV.RAMP_DOWN_MINUTES || 0);
/**
 * Simulated Prometheus scrape interval in seconds.
 * @constant {number}
 */
const SCRAPE_INTERVAL_SECONDS = parseInt(__ENV.SCRAPE_INTERVAL_SECONDS || 30);
/**
 * Minimum host id to simulate.
 * @constant {number}
 */
const HOST_ID_MIN = parseInt(__ENV.HOST_ID_MIN || 0);
/**
 * Maximum host id to simulate.
 * @constant {number}
 */
const HOST_ID_MAX = parseInt(__ENV.HOST_ID_MAX || 100);

/**
 * Number of hosts to simulate.
 * @constant {number}
 */
const HOSTS = HOST_ID_MAX - HOST_ID_MIN;

/**
 * Secret used to authenticate with the proxy.
 * @constant {string}
 */
const PROXY_SECRET = __ENV.PROXY_SECRET || 'abc';

/**
 * Number of virtual organisations to simulate.
 * @constant {number}
 */
const VIRTUAL_ORGANISATIONS_COUNT = parseInt(__ENV.VIRTUAL_ORGANISATIONS_COUNT || 100);

/**
 * Number of cloud accounts to simulate per virtual organisation.
 * @constant {number}
 */
const VIRTUAL_ORGANISATIONS_CLOUD_ACCOUNTS_COUNT = parseInt(__ENV.VIRTUAL_ORGANISATIONS_CLOUD_ACCOUNTS_COUNT || 5);

/**
 * Generates a map of virtual organisations to cloud accounts.
 * @returns {{ [key: string]: string[] }}
 */
function generateVirtualOrganisations() {
    const virtualOrganisations = {};
    for (let i = 0; i < VIRTUAL_ORGANISATIONS_COUNT; i++) {
        const virtualAccounts = [];
        for (let j = 0; j < VIRTUAL_ORGANISATIONS_CLOUD_ACCOUNTS_COUNT; j++) {
            virtualAccounts.push(uuidv4());
        }
        const virtualOrg = uuidv4();
        virtualOrganisations[virtualOrg] = virtualAccounts;
    }
    return virtualOrganisations;
}

export const virtualOrganisations = generateVirtualOrganisations();

export const hostState = {};

function getHostState(id) {
    if (!hostState[id]) {
        const orgs = Object.keys(virtualOrganisations);
        let org = randomItem(orgs);
        let account = randomItem(virtualOrganisations[org]);

        hostState[id] = {
            virtualOrganisation: org,
            cloudAccount: account,
        };
    }
    return hostState[id];
}

/**
 * Support levels to simulate.
 * @constant {string[]}
 */
const support = ['Premium', 'Standard'];
/**
 * URL to write to.
 * @constant {string}
 */
const remote_write_url = REMOTE_WRITE_URL
/**
 * Generates and writes series, checking the results.
 * Requests are tagged with { type: "write" } so that they can be distinguished from queries.
 */
export function write() {
    try {

        const id =  parseInt(`${__VU}`) + parseInt(HOST_ID_MIN);
        const write_client = new remote.Client({
            url: remote_write_url,
            timeout: '70s',
            headers: {
                'x-rh-rhelemeter-gateway-secret': `${PROXY_SECRET}`,
                'x-rh-certauth-cn': `${id}`,
            },
        });

        let state = getHostState(`${id}`);

        const res = write_client.store([{
            "labels": [
                { "name": "__name__", "value": `system_cpu_logical_count` },
                { "name": "_id", "value": `${id}` },
                { "name": "billing_marketplace", "value": "aws" },
                { "name": "billing_marketplace_account", "value": state['cloudAccount'] },
                { "name": "billing_marketplace_instance_id", "value": `${id}` },
                { "name": "billing_model", "value": "marketplace" },
                { "name": "conversions_success", "value": "true" },
                // display_name label can change, we want to ensure we do not double bill on this!
                { "name": "display_name", "value":  randomItem([`${id}`, parseInt(`${__VU}`) + parseInt(HOST_ID_MAX)]) },
                { "name": "external_organization", "value": state['virtualOrganisation'] },
                { "name": "product", "value": 69 },
                { "name": "socket_count", "value": 1 },
                // support label can change, we want to ensure we do not double bill on this!
                { "name": "support", "value": randomItem(support) },
                { "name": "usage", "value": "Production"  },
            ],
            "samples": [
                { "value": randomIntBetween(1,3), }
            ]
        }]);

        check(res, {
            'write worked': (r) => r.status === 200 || r.status === 202 || r.status === 204,
        }, { type: "write" }) || fail(`ERR: write failed. Status: ${res.status}. Body: ${res.body}`);
    }
    catch (e) {
        check(null, {
            'write worked': () => false,
        }, { type: "write" });
        throw e;
    }
}


/**
 * Returns thresholds that include the write path
 * @returns {object}
 */
function buildThresholds() {
    return {
            // SLA: 95% of writes succeed.
            'checks{type:write}': ['rate > 0.95'],
            // 90% of writes take less than 5s (SLA has no guarantee on write latency).
            [`http_req_duration{url:${remote_write_url}}`]: ['p(90.0) < 5000'],
        }
}


/**
 * Returns scenarios that include the write path
 * @returns {object}
 */
function buildScenarios() {
    return  {
            // In each SCRAPE_INTERVAL_SECONDS, WRITE_REQUEST_RATE number of remote-write requests will be made.
            writing_metrics: {
                executor: 'ramping-arrival-rate',
                timeUnit: `${SCRAPE_INTERVAL_SECONDS}s`,

                preAllocatedVUs: HOSTS,
                maxVus: HOSTS,
                exec: 'write',

                stages: [
                    {
                        // Ramp up over a period of RAMP_UP_MIN to the target rate.
                        target: (WRITE_REQUEST_RATE * HOSTS), duration: `${RAMP_UP_MIN}m`,
                    }, {
                        target: (WRITE_REQUEST_RATE * HOSTS),
                        duration: `${DURATION_MIN - RAMP_UP_MIN - RAMP_DOWN_MIN}m`,
                    }, {
                        // Ramp back down over a period of RAMP_DOWN_MIN to a rate of 0.
                        target: 0, duration: `${RAMP_DOWN_MIN}m`,
                    },
                ]
            },
    };

}

/**
 * Exported configuration options for the k6 workers.
 * @constant {object}
 */
export const options = {
    thresholds: buildThresholds(),
    scenarios: buildScenarios()
};
