# Tars — one-command install & ops. Targets shell out to scripts/ (the real logic).
# Fresh Mac:  git clone … && cd tars && make setup && make install-service
SHELL := /bin/bash
SCRIPTS := scripts

.DEFAULT_GOAL := help
.PHONY: help setup install-service uninstall-service start stop restart logs doctor tunnel check test

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-18s\033[0m %s\n",$$1,$$2}'

setup: ## Install prereqs, configure .env, build, and start Postgres (idempotent)
	@bash $(SCRIPTS)/setup.sh

install-service: ## Generate + bootstrap the launchd service (always-on)
	@bash $(SCRIPTS)/service.sh install

uninstall-service: ## Stop and remove the launchd service
	@bash $(SCRIPTS)/service.sh uninstall

start: ## Start the always-on server
	@bash $(SCRIPTS)/service.sh start

stop: ## Stop the always-on server
	@bash $(SCRIPTS)/service.sh stop

restart: ## Restart the always-on server
	@bash $(SCRIPTS)/service.sh restart

logs: ## Tail the server logs
	@bash $(SCRIPTS)/service.sh logs

doctor: ## Verify the whole stack and print fixes
	@bash $(SCRIPTS)/doctor.sh

tunnel: ## Expose the OAuth listener via Tailscale Funnel (for chat Claude)
	@bash $(SCRIPTS)/tunnel.sh

check: ## Run the green gate (format + lint + typecheck + build + test)
	@pnpm check

test: ## Run the test suite
	@pnpm test
