FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-rus python3 python3-openpyxl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY tools ./tools
COPY seed ./seed
COPY server.mjs ./
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TRUST_PROXY=1
RUN mkdir -p /data && useradd -m app && chown -R app /app /data
USER app
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "tools/boot.mjs"]
