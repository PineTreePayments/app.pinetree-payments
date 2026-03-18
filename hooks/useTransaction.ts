import { useEffect, useState } from "react";

export function useTransaction(chargeId: string | null) {

  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {

    if (!chargeId) return;

    const interval = setInterval(async () => {

      const res = await fetch("/api/coinbase/check-charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ charge_id: chargeId })
      });

      const data = await res.json();

      setStatus(data.status);

    }, 3000);

    return () => clearInterval(interval);

  }, [chargeId]);

  return status;
}