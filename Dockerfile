FROM --platform=linux/amd64 golang:1.20.11-bookworm as builder
ENV GOOS=linux GOARCH=amd64
RUN PATH=$(go env GOPATH)/bin:$PATH go install go.k6.io/xk6/cmd/xk6@latest
RUN $GOPATH/bin/xk6 build --with github.com/grafana/xk6-client-prometheus-remote@main
RUN cp k6 "$GOPATH"/bin/k6

FROM alpine:3.13
WORKDIR /k6-scenarios
COPY scripts/* .
COPY --from=builder /go/bin/k6 k6
RUN chmod a+x k6
CMD ["k6"]
