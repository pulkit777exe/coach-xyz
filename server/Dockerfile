FROM oven/bun:1

# Pick up trixie-security patches: the base image otherwise ships known
# HIGH/CRITICAL OS CVEs that fail the CI image scan.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chown=bun:bun package.json bun.lock* ./
RUN if [ -f bun.lock ]; then bun install --frozen-lockfile; else bun install; fi

COPY --chown=bun:bun tsconfig.json ./
COPY --chown=bun:bun src ./src

USER bun

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "start"]
