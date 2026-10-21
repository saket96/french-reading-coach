FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci \
  && cp package-lock.json node_modules/.package-lock.hash

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY . .

EXPOSE 4378

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "4378"]
