FROM oven/bun:1.3.11

WORKDIR /app

# Copy dependency files first (better Docker layer caching)
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY scripts/ ./scripts/

# Expose the port
EXPOSE 3100

# Start the server
CMD ["bun", "run", "src/index.ts"]
