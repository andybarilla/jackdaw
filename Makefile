WAILS_FLAGS = -tags webkit2_41
export GOPROXY ?= https://proxy.golang.org,direct

.PHONY: dev build test check vet lint frontend-install frontend-build frontend-check frontend-test bindings clean

## Development

dev: ## Run in dev mode with hot reload
	wails dev $(WAILS_FLAGS)

build: ## Build production binary
	wails build $(WAILS_FLAGS)

bindings: ## Regenerate Wails JS bindings
	wails generate module

## Testing & Linting

test: ## Run all tests
	go test ./internal/...
	cd frontend && npm run test

check: vet frontend-check ## Run all checks (go vet + svelte-check)

vet:
	go vet ./internal/...

lint: check ## Alias for check

## Frontend

frontend-install: ## Install frontend dependencies
	cd frontend && npm install

frontend-build: ## Build frontend
	cd frontend && npm run build

frontend-check: ## Type-check frontend
	cd frontend && npm run check

frontend-test: ## Run frontend tests
	cd frontend && npm run test

## Utilities

clean: ## Remove build artifacts
	rm -rf build/bin

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
