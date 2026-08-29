FROM nginx:alpine
COPY app/ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY ui/index.html ui/main.js ui/styles.css /usr/share/nginx/html/
COPY ui/admin/index.html /usr/share/nginx/html/admin/index.html
COPY deploy/templates/runtime-config.js /etc/nginx/runtime-config.js
