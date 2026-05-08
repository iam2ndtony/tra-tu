This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment

Create a local environment file if you want to use Oxford credentials. Otherwise, the app uses the free DictionaryAPI.dev provider without any key.

```bash
# dictionary-webapp/.env.local
# Optional: only if you want to use Oxford
USE_OXFORD=true
OXFORD_APP_ID=69753c85
OXFORD_APP_KEY=285df1d44968b25a8e99df8ef7230edc
OXFORD_BASE_URL=https://od-api-sandbox.oxforddictionaries.com/api/v2
```

For free usage without Oxford, leave `.env.local` empty or remove the `USE_OXFORD` and Oxford lines.

## TTS nhóm miễn phí

- Mở tab **TTS Nhóm** trên giao diện.
- Tạo nhóm, thêm từ vào nhóm và chọn giọng US nữ hoặc nam.
- Nhấn **Tạo ZIP âm thanh** để tải xuống ZIP chứa:
  - `group-name/word.mp3` cho mỗi từ
  - `group-name/combined.wav` cho mỗi nhóm, ghép nối với 3 giây im lặng giữa các từ
- Không cần sử dụng API trả phí.

Then run the app with:

```bash
npm install
npm run dev
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
