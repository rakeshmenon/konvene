# Konvene as a container: builds the site, then serves it with nginx.
#   docker build -t konvene .            (pass settings with --build-arg KONVENE_APP_ID=...)
#   docker run -p 8080:80 konvene        then open http://localhost:8080
# Containers have no /api/turn function; use KONVENE_TURN_* for a relay if you need one.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG KONVENE_APP_ID KONVENE_OPERATOR KONVENE_CONTACT_URL KONVENE_REPO_URL KONVENE_RELAYS KONVENE_TURN_URLS KONVENE_TURN_USERNAME KONVENE_TURN_CREDENTIAL
ENV KONVENE_TURN_ENDPOINT=""
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
