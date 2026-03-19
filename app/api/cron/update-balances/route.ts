import { NextResponse } from "next/server";

export async function GET() {
  console.log("Cron running every minute");

  const data = {
    success: true,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(data);
}