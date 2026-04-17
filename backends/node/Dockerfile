FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .
# Frontend is mounted as a volume at /app/frontend by docker-compose
CMD ["node", "server.js"]
