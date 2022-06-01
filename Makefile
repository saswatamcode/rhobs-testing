PROJECT_PATH := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
IMAGE_REPO ?= docker.io/philipgough/k6
VERSION := $(strip $(shell [ -d .git ] && git describe --always --tags --dirty))

.PHONY: image
image:
	docker build -t docker.io/philipgough/k6:$(VERSION) -f $(PROJECT_PATH)/Dockerfile .
