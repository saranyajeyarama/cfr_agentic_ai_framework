FROM node:18-bullseye

WORKDIR /app

COPY package*.json ./

RUN rm -rf node_modules package-lock.json && \
    npm install --legacy-peer-deps

COPY . .

ENV TAILWIND_DISABLE_OXIDE=1

RUN npm run build

EXPOSE 8080

CMD ["npm", "start"]