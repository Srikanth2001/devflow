FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 5000
CMD ["sh", "-c", "npx prisma db push && npm run seed && npm start"]
