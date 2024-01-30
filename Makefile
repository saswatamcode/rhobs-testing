PROJECT_PATH := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
IMAGE_REPO ?= quay.io/philipgough/k6
VERSION := $(strip $(shell [ -d .git ] && git describe --always --tags --dirty))

.PHONY: image
image:
	docker build --platform=linux/amd64 -t quay.io/philipgough/k6:$(VERSION) -f $(PROJECT_PATH)/Dockerfile .
	docker tag quay.io/philipgough/k6:$(VERSION) quay.io/philipgough/k6:latest
