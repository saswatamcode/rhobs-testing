FROM golang:1.17-alpine as builder

WORKDIR "$GOPATH"/src/go.k6.io/k6

RUN go install go.k6.io/xk6/cmd/xk6@latest && \
    xk6 build --with github.com/grafana/xk6-client-prometheus-remote@latest \
    --with github.com/grafana/xk6-output-prometheus-remote@latest && \
    cp k6 "$GOPATH"/bin/k6

FROM alpine:3.13
WORKDIR /k6-scenarios
COPY load.js .
COPY --from=builder /go/bin/k6 k6
CMD ['k6']
