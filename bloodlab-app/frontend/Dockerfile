# build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
# with env var : build-arg/env:
# ARG VITE_API_BASE=/api
# ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# serve stage
FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]