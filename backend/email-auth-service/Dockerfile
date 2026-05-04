# Mocktail email-auth sidecar — Deno on Cloud Run
FROM denoland/deno:alpine-2.5.6

WORKDIR /app

COPY deno.json ./
COPY . ./

# Cache deps
RUN deno cache main.ts

ENV PORT=8080
EXPOSE 8080

USER deno
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read=/app", "main.ts"]
