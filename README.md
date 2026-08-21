# Seleksi 2 Asisten Labpro

Implementasi Identity and Authorization Provider terpusat dengan dua relying
application dan sinkronisasi pencabutan sesi secara asinkron.

## 1. Identitas

- Nama: Yusuf Faishal Listyardi
- NIM: 13524014

## 2. Cara Menjalankan Sistem

Prasyarat: Docker Desktop dengan Docker Compose.

1. Salin `.env.example` menjadi `.env`.
2. Ganti seluruh nilai `replace-with-...` dengan credential lokal. Password
   dalam `AUTH_DATABASE_URL` dan `LOCAL_DATABASE_URL` harus sama dengan
   `POSTGRES_PASSWORD`, sedangkan password dalam `RABBITMQ_URL` harus sama
   dengan `RABBITMQ_PASSWORD`.
3. Jalankan seluruh sistem:

```powershell
docker compose up --build
```

Auth Server otomatis menjalankan migration Auth DB dan Local DB, kemudian
melakukan idempotent seed. Tidak diperlukan setup database manual.

### URL komponen

| Komponen | URL |
| --- | --- |
| Auth Provider Web / Control Panel | http://localhost:4000 |
| Auth Provider API | http://localhost:4001 |
| App A | http://localhost:4100 |
| App A API | http://localhost:4101 |
| App B | http://localhost:4200 |
| App B API | http://localhost:4201 |
| RabbitMQ Management | http://localhost:15672 |

Seed membuat akun `admin@example.com` dan `student@example.com`. Keduanya
menggunakan password dari `SEED_DEFAULT_PASSWORD`. Admin menjadi anggota
group `administrators`, sedangkan student memperoleh akses awal ke App A dan
App B.

Migration dan seed juga dapat dijalankan dari host setelah `.env` tersedia:

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
```

Seluruh environment variable didokumentasikan di
[.env.example](./.env.example). Aplikasi melakukan fail-fast ketika credential
wajib tidak tersedia.

## 3. Arsitektur dan Alur

### Checklist program utama

- [x] F00 - Arsitektur dan Komponen
- [x] F01 - Konfigurasi Dasar dan Infrastruktur
- [x] F02 - Auth Provider Platform: Central Session Server dan Control Panel
- [x] F04 - Relying Applications: App A dan App B
- [x] F05 - Auth Provider Platform: Event Processing

Spesifikasi tidak mendefinisikan bagian F03.

### Arsitektur

```mermaid
flowchart LR
  Browser[Browser] --> AuthWeb[Auth Provider Web]
  Browser --> AppAWeb[App A Web]
  Browser --> AppBWeb[App B Web]
  AuthWeb --> AuthServer[Auth Provider Server]
  AppAWeb --> AppAServer[App A Server]
  AppBWeb --> AppBServer[App B Server]
  AppAServer --> AuthServer
  AppBServer --> AuthServer
  AuthServer --> AuthDB[(Primary PostgreSQL)]
  AppAServer --> LocalDB[(Local PostgreSQL)]
  AppBServer --> LocalDB
  AuthDB --> Worker[Outbox Publisher dan Sync Worker]
  Worker --> RabbitMQ[(RabbitMQ)]
  RabbitMQ --> Worker
  Worker --> AppAServer
  Worker --> AppBServer
```

Auth Provider menyimpan credential, central session, authorization code,
access token, policy, audit log, dan transactional outbox. App A dan App B hanya
menyimpan local session serta profile cache. Keduanya menggunakan Local DB yang
sama secara fisik, tetapi seluruh data diisolasi secara logis menggunakan
`appKey`.

### Alur SSO

1. Relying app membuat `state` dan PKCE verifier pada cookie HttpOnly yang
   diisolasi per aplikasi, lalu mengarahkan browser ke `/oauth/authorize`.
2. Auth Provider memvalidasi central session, status user, status aplikasi,
   redirect URI, serta allow policy group.
3. Auth Provider menerbitkan authorization code berumur pendek dan sekali pakai.
4. Backend relying app menukar code menggunakan PKCE verifier menjadi opaque
   access token.
5. Backend mengambil profil melalui `/oauth/userinfo`, menyimpan profile cache,
   dan membuat local session.

### Alur logout dan revocation

1. Local logout hanya mencabut local session pada aplikasi terkait.
2. SSO logout, perubahan password, penonaktifan user, atau kehilangan policy
   mencabut central session dan access token secara sinkron.
3. Perubahan keamanan dan event outbox disimpan dalam satu transaksi database.
4. Publisher mengirim event persistent ke RabbitMQ setelah broker confirmation.
5. Sync Worker memproses delivery setiap aplikasi secara independen melalui
   `POST /internal/logout`, dengan retry, backoff, DLQ, dan idempotency key
   `(appKey, eventId)`.

## 4. Keputusan Teknis

### Opaque access token

Access token menggunakan nilai opaque. Database hanya menyimpan hash token,
sehingga nilai asli tidak tersimpan. Keuntungannya adalah validasi dan
revocation tetap terpusat serta dapat berlaku langsung. Konsekuensinya, relying
app harus menghubungi endpoint `/oauth/userinfo` milik Auth Provider untuk
memvalidasi token dan mengambil identitas user.

### RabbitMQ

RabbitMQ dipilih karena menyediakan durable queue, publisher confirmation,
acknowledgement, retry queue, dan Dead-Letter Queue. Kegagalan satu aplikasi
tidak menghambat aplikasi lain. Konsekuensinya, sistem memerlukan broker dan
Sync Worker sebagai komponen operasional tambahan.

### Autentikasi service-to-service

`POST /internal/logout` dilindungi shared secret pada header
`x-internal-secret`. Nilainya hanya berasal dari environment variable dan
dibandingkan secara timing-safe. Pada deployment lintas host, komunikasi ini
tetap perlu dilindungi TLS dan secret perlu dirotasi secara berkala.

### Soft-delete dan hard-delete

Session, access token, event, dan delivery menggunakan status serta timestamp
seperti `revokedAt` atau `publishedAt`. Pendekatan soft-delete ini menjaga
histori keamanan dan audit. Relasi membership dan policy menggunakan
hard-delete karena tidak lagi menjadi state aktif; perubahan tersebut tetap
tercatat melalui audit log dan event `AccessPolicyChanged`.

## 5. Technology Stack dan Versi

| Teknologi | Versi yang digunakan |
| --- | --- |
| Node.js | 22 (`node:22-bookworm-slim`) |
| TypeScript | 5.5 |
| Express | 5.1 |
| React | 18.3 |
| Vite | 6.4.3 |
| Tailwind CSS | 3.4 |
| Prisma ORM/CLI | 6.19.3 |
| PostgreSQL | 16 Alpine |
| RabbitMQ | 3 Management Alpine |
| amqplib | 0.10.8 |
| Vitest | 4.1.10 |
| Docker Compose | Compose Specification |

## 6. Daftar Endpoint

| Komponen | Method dan path | Fungsi |
| --- | --- | --- |
| Auth | `GET /health`, `GET /health/live` | Liveness Auth Server tanpa memeriksa dependency |
| Auth | `GET /health/ready` | Readiness Primary DB dan RabbitMQ |
| Auth | `POST /auth/login`, `POST /auth/logout` | Central login dan SSO logout |
| OAuth | `GET /oauth/authorize` | Validasi client, redirect URI, session, dan policy; terbitkan code |
| OAuth | `POST /oauth/token` | Tukar authorization code menjadi opaque access token |
| OAuth | `GET /oauth/userinfo` | Ambil profil berdasarkan bearer token |
| Admin | `GET /admin/session` | Validasi sesi administrator |
| Admin | `GET/POST /admin/users`, `PATCH /admin/users/:id` | Lihat, buat, ubah, aktifkan, atau nonaktifkan user |
| Admin | `GET/POST /admin/groups`, `PATCH /admin/groups/:id` | Lihat, buat, dan ubah group |
| Admin | `POST /admin/groups/:id/users`, `DELETE /admin/groups/:groupId/users/:userId` | Tambah atau hapus membership |
| Admin | `GET /admin/memberships` | Lihat seluruh membership |
| Admin | `GET/POST /admin/applications`, `PATCH /admin/applications/:id` | Kelola konfigurasi dan status aplikasi |
| Admin | `POST /admin/applications/:id/policies`, `DELETE /admin/applications/:applicationId/policies/:groupId` | Tambah atau hapus allow policy |
| Admin | `GET /admin/policies`, `GET /admin/audit-logs`, `GET /admin/events` | Monitoring policy, audit, dan event |
| App A/B | `GET /health`, `POST /login/start`, `GET /auth/callback` | Health dan authorization code flow |
| App A/B | `GET /session`, `POST /logout` | Status local session dan local logout |
| App A/B | `GET /activity-logs`, `GET /processed-events` | Data operasional aplikasi |
| App A/B | `POST /internal/logout` | Back-channel revocation dari Sync Worker |

Semua error API menggunakan envelope
`{ error: { code, message, requestId } }`.

## 7. Bonus

- [ ] B01 - MFA atau WebAuthn
- [ ] B02 - Observability
- [x] B03 - Liveness dan Readiness Probe
- [ ] B04 - Graceful Shutdown

B03 menyediakan `GET /health/live` yang tidak memeriksa dependency dan
`GET /health/ready` yang memeriksa Primary DB serta RabbitMQ secara paralel.
Readiness memiliki timeout melalui `HEALTH_READINESS_TIMEOUT_MS`, mengembalikan
`503` ketika dependency gagal, dan tidak membocorkan detail internal.

## 8. Screenshot

### Auth Provider Control Panel

![Auth Provider Control Panel](./screenshots/auth-control-panel.svg)

### App A Dashboard

![App A Dashboard](./screenshots/app-a-dashboard.svg)
