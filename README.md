# RHOBS Testing

A collection of scripts and tooling to enable testing of [Observatorium](https://github.com/observatorium) on Kubernetes.

The load testing Job uses the [k6](https://k6.io/docs/) 
testing framework and the script has been adapted from Grafanas' Mimir
[load test](https://github.com/grafana/mimir/blob/7305bfc150aa8def87d798676be8d2f1a2101646/operations/k6/load-testing-with-k6.js).

## Dependencies

Since [observatorium-api](https://github.com/observatorium/api) requires authentication, we can deploy the 
[token-refresher](https://github.com/observatorium/token-refresher) proxy in front of k6 to
add an authorization header to each request.

*Setup Token Refresher:*

These examples use the namespace `rhobs-testing` but the commands and manifests can be edited accordingly.

Create a Secret:

```shell
kubectl -n rhobs-testing create secret generic token-refresher-oidc \
  --from-literal=audience=<aud> \
  --from-literal=clientID=<client_id> \
  --from-literal=clientSecret=<client_secret>
  --from-literal=issuerURL=<issuer_url> \
  --from-literal=apiURL=<observatorium_api_url>
```

Deploy token-refresher:

```shell
kubectl -n rhobs-testing apply -f deploy/token-refresher/deploy.yaml
```

Expose token-refresher Service:

```shell
kubectl -n rhobs-testing apply -f deploy/token-refresher/service.yaml
```

*Setup Prometheus:*

k6 [can remote-write Prometheus metrics](https://k6.io/docs/results-visualization/prometheus/) from the test
and the Job supports this. We can optionally deploy a Prometheus Custom Resource to act as a remote-write enabled
endpoint to store these metrics. 

*Note, this requires [prometheus-operator](https://github.com/prometheus-operator/prometheus-operator)*

Deploy Prometheus:

```shell
kubectl -n rhobs-testing apply -f deploy/prometheus-sink/run.yaml
```

Create the Secret:
```shell
kubectl -n rhobs-testing create secret generic remote-write-secret \
 --from-literal=url=http://prometheus-operated.rhobs-testing.svc.cluster.local:9090/api/v1/write
```

## Tools & Scripts

### Snapshotting

You may want to snapshot the TSDB from the optionally deployed Prometheus for k6 metrics. 

```shell
kubectl -n rhobs-testing exec prometheus-prometheus-0 -c prometheus -- sh -c 'wget  --post-data "" localhost:9090/api/v1/admin/tsdb/snapshot -O $RANDOM'
kubectl -n rhobs-testing cp rhobs-testing/prometheus-prometheus-0:/prometheus/snapshots .
```

### Cleanup

After a test run, you may want to clean up the data. Observatorium uses a Thanos Receive backend which in turn writes
to object storage. The script at `cmd/janitor` supports a clean-up of data from a provided list of StatefulSets, by
scaling down the resource to zero and deleting any associated PersistentVolumeClaims as well as removal of objects from 
a s3 bucket.

An example config is provided below and can be run via:

`go run cmd/janitor/main.go --config=/some/path/toFile.json`

```json
{
  "statefulsets": [
    {
      "namespace": "observatorium-metrics",
      "name": "observatorium-thanos-receive-default",
      "waitMinutes": 3
    }
  ],
  "awsConfig" : {
    "region": "eu-central-1",
    "bucketName": "some-bucket",
    "secretKey": "secret-key",
    "accessKey": "access-key"
  }
}
```
