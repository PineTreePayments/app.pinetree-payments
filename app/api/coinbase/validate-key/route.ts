import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { apiKey } = await req.json();

    const response = await fetch(
      "https://api.commerce.coinbase.com/charges?limit=1",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-CC-Api-Key": apiKey,
          "X-CC-Version": "2018-03-22",
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }

    return NextResponse.json({ valid: true });

  } catch (error) {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}