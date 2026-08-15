FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=development

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY auth-provider ./auth-provider
COPY applications ./applications
COPY prisma ./prisma

RUN npm ci
RUN npm run db:generate

EXPOSE 4000 4001 4100 4101 4200 4201

CMD ["npm", "run", "build"]
