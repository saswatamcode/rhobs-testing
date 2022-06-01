### Dependencies

* [token-refresher](https://github.com/observatorium/token-refresher)

### Setup

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
