FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 4378

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "4378"]
