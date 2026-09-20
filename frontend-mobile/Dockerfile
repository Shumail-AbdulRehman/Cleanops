FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG EXPO_PUBLIC_API_BASE_URL=/api
ENV EXPO_PUBLIC_API_BASE_URL=${EXPO_PUBLIC_API_BASE_URL}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:web \
  && if [ -d dist ]; then mv dist web-build; elif [ -d dist-web ]; then mv dist-web web-build; else echo "Expo web output directory not found" && exit 1; fi

FROM nginx:1.27-alpine AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web-build /usr/share/nginx/html
EXPOSE 80
