# Klatch as a container: builds the site, then serves it with nginx.
#   docker build -t klatch .            (pass settings with --build-arg KLATCH_APP_ID=...)
#   docker run -p 8080:80 klatch        then open http://localhost:8080
# Containers have no /api/turn function; use KLATCH_TURN_* for a relay if you need one.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG KLATCH_APP_ID KLATCH_OPERATOR KLATCH_CONTACT_URL KLATCH_REPO_URL KLATCH_RELAYS KLATCH_TURN_URLS KLATCH_TURN_USERNAME KLATCH_TURN_CREDENTIAL
ENV KLATCH_TURN_ENDPOINT=""
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
