FROM python:3.12-slim
WORKDIR /app
COPY server.py index.html style.css app.js config.js store-server.js questions.json featured_packs.json ./
COPY backgrounds ./backgrounds
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data
EXPOSE 8080
CMD ["python3", "server.py"]
