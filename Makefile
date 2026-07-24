.PHONY: backend frontend dev

backend:
	venv/bin/uvicorn app.main:app --reload --port 8000 --app-dir backend

frontend:
	cd frontend && npm run dev

dev:
	@trap 'kill 0' SIGINT; \
	$(MAKE) backend & \
	$(MAKE) frontend & \
	wait
