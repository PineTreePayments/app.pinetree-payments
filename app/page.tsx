"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Page =
  | "dashboard"
  | "pos"
  | "confirm"
  | "processing"
  | "transactions"
  | "transactionDetail";
type Provider = "Shift4" | "Coinbase Commerce";

function CardWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-2xl p-8 min-h-[380px] max-h-[70vh] overflow-y-auto shadow-inner relative text-black">
      {children}
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLogin, setIsLogin] = useState(true);

  const [cents, setCents] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>("pos");

  const [provider, setProvider] = useState<Provider>("Shift4");
  const [apiKey, setApiKey] = useState("");
  const [apiConnected, setApiConnected] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [toast, setToast] = useState<{ msg: string; kind: "error" | "success" } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [showShift4Modal, setShowShift4Modal] = useState(false);
  const [shift4Url, setShift4Url] = useState<string | null>(null);

  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const [coinbaseHostedUrl, setCoinbaseHostedUrl] = useState<string | null>(null);
  const [coinbaseChargeId, setCoinbaseChargeId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<
  "pending" | "processing" | "confirmed" | "failed"
>("pending");
  const [isCharging, setIsCharging] = useState(false);

  const [transactions, setTransactions] = useState<any[]>([]);
  const [selectedTx, setSelectedTx] = useState<any | null>(null);

  const formatCurrency = (value: number) =>
    (value / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const showToast = (msg: string, kind: "error" | "success" = "error") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const getSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setAuthLoading(false);
    };

    getSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const checkConnection = async () => {
      if (!session?.user?.id) return;

      const { data, error } = await supabase
        .from("merchant_settings")
        .select("coinbase_api_key")
        .eq("merchant_id", session.user.id)
        .single();

      if (!error && data?.coinbase_api_key) {
        setApiConnected(true);
        setApiKey(data.coinbase_api_key);
      } else {
        setApiConnected(false);
      }
    };

    checkConnection();
  }, [session]);

  useEffect(() => {
  if (!session?.user?.id) return;

  fetchTransactions();
}, [session]);

useEffect(() => {
  if (!session?.user?.id) return;

  const channel = supabase
    .channel("transactions-channel")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "transactions",
        filter: `merchant_id=eq.${session.user.id}`,
      },
      (payload) => {
        fetchTransactions();

        if (!coinbaseChargeId) return;

        const updated = payload.new as any;

        if (
  updated &&
  updated.provider_transaction_id === coinbaseChargeId
) {
  if (updated.status === "confirmed") {
    setPaymentStatus("processing");

    setTimeout(() => {
      setPaymentStatus("confirmed");
    }, 1200);
  } else {
    setPaymentStatus(updated.status);
  }
}
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [session, coinbaseChargeId]);

  useEffect(() => {
    const savedProvider = localStorage.getItem("provider") as Provider | null;
    const savedConnected = localStorage.getItem("apiConnected");

    if (savedProvider === "Shift4" || savedProvider === "Coinbase Commerce") {
      setProvider(savedProvider);
    }

    if (savedConnected === "true") setApiConnected(true);

    setApiKey("");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    setApiConnected(false);
    localStorage.setItem("provider", provider);
    localStorage.setItem("apiConnected", "false");
  }, [provider, hydrated]);

  const handleLogin = async () => {
    const e = email.trim();
    const p = password.trim();

    if (!e || !p) {
      showToast("Invalid email/password", "error");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: e,
      password: p,
    });

    if (error) {
      showToast("Invalid email/password", "error");
      return;
    }

    showToast("Logged in successfully", "success");
    setCurrentPage("dashboard");
  };

  const handleSignup = async () => {
    const e = email.trim();
    const p = password.trim();

    if (!e || !p) {
      showToast("Please enter an email and password", "error");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: e,
      password: p,
    });

    if (error) {
      showToast(error.message, "error");
      return;
    }

    showToast("Signup successful. Please log in.", "success");
    setIsLogin(true);
  };

  const handleForgotPassword = async () => {
    const e = email.trim();
    if (!e) {
      showToast("Enter your email first", "error");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(e, {
      redirectTo:
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/reset`
          : undefined,
    });

    if (error) {
      showToast(error.message, "error");
      return;
    }

    showToast("Password reset email sent", "success");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setEmail("");
    setPassword("");
    setIsLogin(true);
    setMenuOpen(false);
    setApiKey("");
    setApiConnected(false);
  };

  const goTo = (page: Page) => {
    setMenuOpen(false);
    if (currentPage === "processing" && page === "pos") {
      setCents(0);
    }
    setCurrentPage(page);
  };

  const handleKeypad = (value: string) => {
    if (value === "del") {
      setCents((prev) => Math.floor(prev / 10));
      return;
    }

    if (value === "clear") {
      setCents(0);
      return;
    }

    if (cents.toString().length >= 12) return;

    const digit = parseInt(value, 10);
    if (!Number.isNaN(digit)) setCents((prev) => prev * 10 + digit);
  };

  const saveApiKey = async () => {
    if (!apiKey) {
      showToast("Enter API key first", "error");
      return;
    }

    try {
      const res = await fetch("/api/coinbase/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });

      const data = await res.json();

      if (!res.ok || !data.valid) {
        showToast("Invalid API Key for selected provider", "error");
        return;
      }

      const { error } = await supabase
        .from("merchant_settings")
        .upsert(
          {
            merchant_id: session?.user?.id,
            provider,
            coinbase_api_key: apiKey,
          },
          { onConflict: "merchant_id" }
        );

      if (error) {
        showToast("Failed to save API key", "error");
        return;
      }

      setApiConnected(true);
      showToast("Configuration Saved", "success");
    } catch {
      showToast("Something went wrong", "error");
    }
  };

  const handleCharge = async () => {
  if (isCharging) return;

  // 🔒 Ensure session is ready
  if (!session?.user?.id) {
    showToast("Session not ready. Please try again.", "error");
    return;
  }

  setIsCharging(true);

  if (!apiConnected) {
    showToast("Configure provider first", "error");
    setIsCharging(false);
    return;
  }

  if (cents <= 0) {
    showToast("Enter an amount", "error");
    setIsCharging(false);
    return;
  }

  const platformFee = 5; // 5 cents
  const total = cents + platformFee;

  console.log("SESSION USER ID:", session?.user?.id);

  try {
    const res = await fetch("/api/coinbase/create-charge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: total,
        merchant_id: session.user.id, // no optional chaining
      }),
    });

    const data = await res.json();

    if (!res.ok) {
  console.log("BACKEND ERROR:", data);
  showToast(
    typeof data?.error === "string"
      ? data.error
      : data?.error?.message || "Failed to create charge",
    "error"
  );
  setIsCharging(false);
  return;
}

    const hostedUrl = data.hosted_url;
    const chargeId = data.charge_id;

    if (!hostedUrl || !chargeId) {
      showToast("Invalid charge response", "error");
      setIsCharging(false);
      return;
    }

    setCoinbaseHostedUrl(hostedUrl);
    setCoinbaseChargeId(chargeId);
    setPaymentStatus("pending");
    setCurrentPage("processing");

  } catch (error) {
    showToast("Charge creation failed", "error");
    setIsCharging(false);
  }
};

    const handleShift4Apply = async () => {
    try {
      const res = await fetch("/api/shift4/apply", { method: "POST" });
      const data = await res.json();

      if (!data?.url) {
        showToast("Unable to start Shift4 application", "error");
        return;
      }

      setShift4Url(data.url);
      setShowShift4Modal(true);
    } catch {
      showToast("Shift4 connection error", "error");
    }
  };

  const fetchTransactions = async () => {
  if (!session?.user?.id) return;

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("merchant_id", session.user.id)
    .order("created_at", { ascending: false });

  if (!error && data) {
    setTransactions(data);
  }
};

  const toastClass = useMemo(() => {
    if (!toast) return "";
    return toast.kind === "success" ? "bg-green-600" : "bg-red-500";
  }, [toast]);

  const menuBtnClass =
    "w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition";
  const menuBtnDangerClass =
    "w-full py-2.5 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition";
  const keypadBtnClass =
    "py-3.5 text-lg font-semibold rounded-xl bg-white border border-gray-200 shadow-sm text-black hover:bg-gray-100 active:bg-gray-200 transition";
  const keypadSmallBtnClass =
    "py-3.5 text-sm font-semibold rounded-xl bg-white border border-gray-200 shadow-sm text-black hover:bg-gray-100 active:bg-gray-200 transition";

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center text-black">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen bg-gray-100 flex items-center justify-center relative">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-[420px] text-black relative">
          <h2 className="text-2xl font-semibold mb-6 text-center text-black">
            {isLogin ? "Merchant Login" : "Create Account"}
          </h2>

          <div className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="email"
            />

            <div className="relative w-full">
  <input
    type={showPassword ? "text" : "password"}
    placeholder="Password"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-black placeholder-gray-500 pr-16"
    autoComplete={isLogin ? "current-password" : "new-password"}
  />

  <button
    type="button"
    onClick={() => setShowPassword((prev) => !prev)}
    className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500 hover:text-black"
  >
    {showPassword ? "Hide" : "Show"}
  </button>
</div>

            <button
              onClick={isLogin ? handleLogin : handleSignup}
              className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
            >
              {isLogin ? "Login" : "Sign Up"}
            </button>

            {isLogin && (
              <button
                onClick={handleForgotPassword}
                className="w-full text-sm text-blue-600 hover:underline"
              >
                Forgot password?
              </button>
            )}

            <button
              onClick={() => setIsLogin(!isLogin)}
              className="w-full text-sm text-blue-600 hover:underline"
            >
              {isLogin
                ? "Need an account? Sign up"
                : "Already have an account? Login"}
            </button>
          </div>

          {toast && (
            <div
              className={`absolute top-4 right-4 ${toastClass} text-white px-4 py-2 rounded-lg shadow-sm text-xs`}
            >
              {toast.msg}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-100 flex items-center justify-center">
      <div
        className="relative w-[460px] bg-white rounded-2xl shadow-2xl p-6 overflow-hidden text-black"
        onClick={() => menuOpen && setMenuOpen(false)}
      >
        <div className="flex justify-between items-center mb-4 relative z-30">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="text-2xl font-semibold text-black hover:text-blue-600 transition"
          >
            ☰
          </button>

          {(currentPage === "processing" ||
  currentPage === "transactionDetail") && (
  <button
    onClick={() => {
      if (currentPage === "transactionDetail") {
        setCurrentPage("transactions");
      } else {
        goTo("pos");
      }
    }}
    className="text-base font-semibold text-black hover:text-blue-600 transition -tracking-[1px]"
  >
    {"<<<"}
  </button>
)}
        </div>

        <div className="relative z-10">
          {currentPage === "dashboard" && (
            <CardWrapper>
              <div className="absolute top-6 right-6 flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${
                    apiConnected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-xs font-medium text-black">
                  {apiConnected ? "Configured" : "Not Configured"}
                </span>
              </div>

              <h2 className="text-xl font-semibold mb-6 text-black">
                Merchant Dashboard
              </h2>

              <div className="space-y-5 mt-2">
                <div>
                  <label className="block text-sm font-medium text-black mb-2">
                    Provider
                  </label>
                  <select
                    value={provider}
                    onChange={(e) =>
                      setProvider(e.target.value as Provider)
                    }
                    className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-black font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option>Shift4</option>
                    <option>Coinbase Commerce</option>
                  </select>
                </div>

                {provider === "Coinbase Commerce" && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-black mb-2">
                        Coinbase API Key
                      </label>

                      <div className="relative">
                        <input
                          type={showApiKey ? "text" : "password"}
                          value={apiKey}
                          onChange={(e) =>
                            setApiKey(e.target.value)
                          }
                          placeholder="Enter Coinbase API Key"
                          className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 pr-14 text-black placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoComplete="off"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            setShowApiKey((prev) => !prev)
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-600 hover:text-black"
                        >
                          {showApiKey ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={saveApiKey}
                      className={menuBtnClass}
                    >
                      Save Configuration
                    </button>

                    {apiConnected && (
                      <button
                        onClick={async () => {
                          const { error } = await supabase
                            .from("merchant_settings")
                            .update({
                              coinbase_api_key: null,
                            })
                            .eq(
                              "merchant_id",
                              session?.user?.id
                            );

                          if (error) {
                            showToast(
                              "Failed to remove API key",
                              "error"
                            );
                            return;
                          }

                          setApiConnected(false);
                          setApiKey("");
                          showToast(
                            "API Key Removed",
                            "success"
                          );
                        }}
                        className="w-full mt-3 py-2.5 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition"
                      >
                        Remove API Key
                      </button>
                    )}
                  </>
                )}

                {provider === "Shift4" && (
                  <>
                    <p className="text-sm text-black">
                      Apply with Shift4 to activate card
                      processing. You’ll complete the
                      sensitive form in a secure Shift4
                      window without leaving the app.
                    </p>

                    <button
                      onClick={handleShift4Apply}
                      className={menuBtnClass}
                    >
                      Apply with Shift4
                    </button>
                  </>
                )}
              </div>
            </CardWrapper>
          )}

          {currentPage === "pos" && (
            <CardWrapper>
              <div className="text-center">
                <div className="text-4xl font-semibold mb-8 text-black">
                  ${formatCurrency(cents)}
                </div>

                <div className="grid grid-cols-3 gap-4 mb-6">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
                    <button
                      key={k}
                      onClick={() => handleKeypad(k)}
                      className={keypadBtnClass}
                    >
                      {k}
                    </button>
                  ))}

                  <button
                    onClick={() => handleKeypad("clear")}
                    className={keypadSmallBtnClass}
                  >
                    Clear
                  </button>

                  <button
                    onClick={() => handleKeypad("0")}
                    className={keypadBtnClass}
                  >
                    0
                  </button>

                  <button
                    onClick={() => handleKeypad("del")}
                    className={keypadBtnClass}
                  >
                    ⌫
                  </button>
                </div>

                <button
                  onClick={() => {
                    if (!apiConnected) {
                      showToast("Configure provider first", "error");
                      return;
                    }

                    if (cents <= 0) {
                      showToast("Enter an amount", "error");
                      return;
                    }

                    setCurrentPage("confirm");
                  }}
                  className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
                >
                  Charge
                </button>
              </div>
            </CardWrapper>
          )}

          {currentPage === "confirm" && (
            <CardWrapper>
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-6">
                  Confirm Transaction
                </h2>

                <div className="text-sm text-gray-700 w-full max-w-xs mx-auto space-y-3">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>${formatCurrency(cents)}</span>
                  </div>

                  <div className="flex justify-between">
                    <span>Platform Fee</span>
                    <span>$0.05</span>
                  </div>

                  <div className="flex justify-between font-semibold border-t pt-3 mt-3 text-black">
                    <span>Total</span>
                    <span>${formatCurrency(cents + 5)}</span>
                  </div>
                </div>

                <div className="mt-8 flex gap-4">
                  <button
                    onClick={() => setCurrentPage("pos")}
                    className="w-full py-2.5 rounded-xl bg-gray-200 text-black font-semibold hover:bg-gray-300 transition"
                  >
                    Back
                  </button>

                  <button
                    onClick={handleCharge}
                    className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </CardWrapper>
          )}

          {currentPage === "processing" && coinbaseHostedUrl && (
            <CardWrapper>
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-6 text-black">
                  Scan to Pay
                </h2>

                {paymentStatus !== "confirmed" && (
  <div className="flex justify-center mb-6">
    <img
      src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
        coinbaseHostedUrl
      )}`}
      alt="QR Code"
      className="rounded-xl shadow-md"
    />
  </div>
)}

                {/* Pending State */}
{paymentStatus !== "confirmed" && (
  <div className="flex flex-col items-center justify-center mt-6">

    {/* Blinking Circle */}

    <div className="mt-4 flex items-center justify-center text-base font-medium text-gray-700">
  <div
  className={`
    w-3 h-3 rounded-full mr-2 animate-pulse
    ${paymentStatus === "pending" ? "bg-yellow-500" : ""}
    ${paymentStatus === "processing" ? "bg-blue-500" : ""}
    ${paymentStatus === "failed" ? "bg-red-500" : ""}
  `}
></div>

{paymentStatus === "pending" && "Waiting for Payment"}
{paymentStatus === "processing" && "Processing Payment"}
{paymentStatus === "failed" && "Payment Failed"}
</div>

  </div>
)}

{/* Confirmed State */}
{paymentStatus === "confirmed" && (
  <div className="flex flex-col items-center justify-center min-h-[350px]">

    <div className="w-36 h-36 rounded-full bg-green-500 flex items-center justify-center shadow-xl transition-all duration-300 scale-110">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-20 w-20 text-white"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={3}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 13l4 4L19 7"
        />
      </svg>
    </div>

    <h3 className="text-2xl font-semibold mt-6 text-green-600 text-center">
      Payment Confirmed
    </h3>

  </div>
)}


                </div>
            </CardWrapper>
          )}

          {currentPage === "transactions" && (
            <CardWrapper>
              <h2 className="text-xl font-semibold mb-4 text-black">
                Transaction History
              </h2>
              {transactions.length === 0 ? (
  <p className="text-black">No transactions yet.</p>
) : (
  <div className="space-y-3">
    {transactions.map((tx) => (
  <div
    key={tx.id}
    onClick={() => {
  setSelectedTx(tx);
  setCurrentPage("transactionDetail");
}}
    className="p-3 bg-gray-100 rounded-xl flex justify-between items-center cursor-pointer hover:bg-gray-200 transition"
  >
        <div>
          <div className="font-semibold text-sm">
            ${formatCurrency(tx.total_amount)}
          </div>
          <div className="text-xs text-gray-600">
            {new Date(tx.created_at).toLocaleString()}
          </div>
        </div>

        <div
          className={`text-xs font-semibold ${
            tx.status === "confirmed"
              ? "text-green-600"
              : tx.status === "failed"
              ? "text-red-600"
              : "text-blue-600"
          }`}
        >
          {tx.status}
        </div>
      </div>
    ))}
  </div>
)}

            </CardWrapper>
          )}
          {currentPage === "transactionDetail" && selectedTx && (
  <CardWrapper>
    <div className="text-center mb-6">
      <h2 className="text-xl font-semibold text-black">
        Transaction Details
      </h2>
    </div>

    <div className="space-y-4 text-sm text-black">

      <div className="flex justify-between">
        <span className="text-gray-500">Amount</span>
        <span className="font-semibold">
          ${formatCurrency(selectedTx.total_amount)}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-gray-500">Status</span>
        <span
          className={`font-semibold ${
            selectedTx.status === "confirmed"
              ? "text-green-600"
              : selectedTx.status === "failed"
              ? "text-red-600"
              : "text-blue-600"
          }`}
        >
          {selectedTx.status}
        </span>
      </div>

      <div className="flex justify-between">
        <span className="text-gray-500">Created</span>
        <span>
          {new Date(selectedTx.created_at).toLocaleString()}
        </span>
      </div>

      {selectedTx.provider_transaction_id && (
        <div>
          <span className="text-gray-500 text-xs">
            Transaction ID
          </span>

          <div className="mt-2 flex items-center justify-between bg-gray-100 rounded-lg px-3 py-2">
            <span className="truncate text-xs">
              {selectedTx.provider_transaction_id}
            </span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  selectedTx.provider_transaction_id
                );
                showToast("Copied to clipboard", "success");
              }}
              className="text-xs text-blue-600 hover:underline ml-2"
            >
              Copy
            </button>
          </div>
        </div>
      )}

    </div>
  </CardWrapper>
)}
        </div>

        {toast && (
          <div
            className={`absolute top-4 right-4 ${toastClass} text-white px-4 py-2 rounded-lg shadow-sm text-xs`}
          >
            {toast.msg}
          </div>
        )}

        {showDisclaimer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white w-[650px] max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl relative p-6">
              <button
                onClick={() => setShowDisclaimer(false)}
                className="absolute top-4 right-4 text-black hover:text-gray-700 text-lg font-semibold"
              >
                ✕
              </button>

              <h2 className="text-xl font-semibold mb-4 text-black">
                Terms & Disclosures
              </h2>

              <div className="text-[13px] leading-snug space-y-3 text-gray-700">
                <p className="font-semibold text-black">Effective Date: January 1, 2026</p>

<p>
These Terms and Disclosures ("Terms") govern access to and use of the PineTree Payments platform (the "Platform"), operated by PineTree Payments LLC ("PineTree Payments," "Company," "we," "us," or "our"). By accessing, registering for, or using the Platform, you ("Merchant," "User," or "you") acknowledge that you have read, understood, and agree to be legally bound by these Terms.
</p>

<h3 className="font-semibold text-black mt-4">1. Nature of Services</h3>

<p>
PineTree Payments provides a software-based technology interface that enables merchants to connect with independent third-party payment processors and cryptocurrency service providers. PineTree Payments does not process payments, transmit money, store funds, custody digital assets, provide escrow services, or act as a financial intermediary.
</p>

<p>
All transactions initiated through the Platform are processed exclusively by third-party service providers, including but not limited to Shift4 Payments and Coinbase Commerce. PineTree Payments does not control, manage, or influence underwriting decisions, approval status, transaction processing, settlement timelines, compliance determinations, risk assessments, chargeback handling, or dispute resolution conducted by such third parties.
</p>

<p>
Merchant acknowledges that PineTree Payments assesses a fixed platform facilitation fee of five cents (USD $0.05) per successfully initiated transaction processed through the Platform. This fee is separate from and in addition to any third-party processing fees, interchange fees, blockchain network fees, miner fees, chargeback fees, reserve requirements, or other amounts imposed by independent payment processors. PineTree Payments reserves the right to modify its fee structure upon reasonable notice.
</p>

<h3 className="font-semibold text-black mt-4">2. No Financial Institution Status</h3>

<p>
PineTree Payments is not a bank, money services business (MSB), money transmitter, broker-dealer, investment advisor, clearing agency, cryptocurrency exchange, or custodian. The Company does not hold customer deposits, maintain escrow accounts, provide digital wallet services, or assume fiduciary duties.
</p>

<p>
Merchants understand that PineTree Payments merely facilitates API connectivity and workflow automation between the Merchant and independent payment processors.
</p>

<h3 className="font-semibold text-black mt-4">3. Cryptocurrency Risk Disclosure</h3>

<p>
Cryptocurrency transactions involve significant risk, including but not limited to price volatility, blockchain congestion, confirmation delays, irreversible transactions, network forks, protocol updates, smart contract vulnerabilities, and private key loss. Digital asset values may fluctuate substantially within short periods.
</p>

<p>
Transactions executed on blockchain networks are irreversible. PineTree Payments is not responsible for incorrect wallet addresses, expired payment windows, QR code misuse, miner fee fluctuations, failed confirmations, or digital asset valuation losses.
</p>

<h3 className="font-semibold text-black mt-4">4. Merchant Regulatory Responsibility</h3>

<p>
Merchants are solely responsible for ensuring compliance with all applicable federal, state, and local laws, including but not limited to anti-money laundering (AML), know-your-customer (KYC), sanctions screening, tax reporting, consumer protection statutes, and industry-specific regulatory requirements.
</p>

<p>
PineTree Payments does not provide legal, compliance, accounting, or tax advice. Merchants are encouraged to consult independent counsel before engaging in cryptocurrency or card-based payment acceptance.
</p>

<h3 className="font-semibold text-black mt-4">5. Third-Party Provider Disclaimer</h3>

<p>
PineTree Payments makes no representations or warranties regarding third-party processors. The Company is not responsible for account denials, underwriting decisions, transaction declines, rolling reserves, chargebacks, frozen accounts, terminated services, regulatory actions, or service outages caused by third-party providers.
</p>

<p>
All disputes relating to payment processing must be resolved directly between the Merchant and the applicable third-party processor.
</p>

<h3 className="font-semibold text-black mt-4">6. Limitation of Liability</h3>

<p>
To the fullest extent permitted by law, PineTree Payments shall not be liable for any indirect, incidental, consequential, special, exemplary, punitive, or lost profit damages, including but not limited to loss of revenue, loss of data, business interruption, reputational harm, or regulatory penalties.
</p>

<p>
In no event shall PineTree Payments’ aggregate liability exceed the total platform fees paid by Merchant during the preceding ninety (90) days.
</p>

<h3 className="font-semibold text-black mt-4">7. Indemnification</h3>

<p>
Merchant agrees to indemnify, defend, and hold harmless PineTree Payments LLC, its officers, members, employees, contractors, and affiliates from and against any claims, damages, liabilities, losses, costs, or expenses (including attorneys’ fees) arising out of:
</p>

<ul className="list-disc ml-6 text-gray-700">
  <li>Merchant’s misuse of the Platform</li>
  <li>Violation of applicable laws or regulations</li>
  <li>Fraudulent or unlawful transactions</li>
  <li>Chargebacks, disputes, or consumer claims</li>
  <li>Cryptocurrency transaction losses</li>
  <li>Failure to comply with third-party processor terms</li>
</ul>

<h3 className="font-semibold text-black mt-4">8. No Warranty</h3>

<p>
The Platform is provided on an "as is" and "as available" basis without warranties of any kind, express or implied. PineTree Payments disclaims all warranties, including merchantability, fitness for a particular purpose, and non-infringement.
</p>

<p>
We do not guarantee uninterrupted operation, continuous uptime, or error-free functionality.
</p>

<h3 className="font-semibold text-black mt-4">9. Force Majeure</h3>

<p>
PineTree Payments shall not be liable for delays or failures resulting from events beyond reasonable control, including but not limited to acts of God, natural disasters, internet outages, cyberattacks, governmental actions, regulatory changes, or blockchain network disruptions.
</p>

<h3 className="font-semibold text-black mt-4">10. Arbitration & Governing Law</h3>

<p>
Any disputes arising from or relating to the Platform shall be resolved through binding arbitration in the State of Missouri under the rules of the American Arbitration Association. These Terms shall be governed by the laws of the State of Missouri, without regard to conflict-of-law principles.
</p>

<h3 className="font-semibold text-black mt-4">11. Modifications</h3>

<p>
PineTree Payments reserves the right to modify these Terms at any time. Continued use of the Platform following updates constitutes acceptance of the revised Terms.
</p>

<p className="font-semibold text-black mt-4">
If you do not agree to these Terms and Disclosures, you must immediately discontinue use of the Platform.
</p>
              </div>
            </div>
          </div>
        )}

        {/* ✅ FIXED SIDEBAR — NO LONGER DEPENDENT ON showShift4Modal */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-0 left-0 h-full w-72 bg-white border-r border-gray-200 shadow-xl transform transition-transform duration-300 z-40 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-6 flex flex-col gap-4 h-full text-black">
            <div className="font-semibold text-lg text-black text-center">
              Menu
              <div className="mt-3 h-px bg-gray-200" />
            </div>

            <button
              onClick={() => goTo("dashboard")}
              className={menuBtnClass}
            >
              Dashboard
            </button>

            <button
              onClick={() => goTo("pos")}
              className={menuBtnClass}
            >
              POS
            </button>

            <button
              onClick={() => goTo("transactions")}
              className={menuBtnClass}
            >
              Transaction History
            </button>

            <div className="mt-auto flex flex-col gap-3">
  <button
    onClick={() => {
      setMenuOpen(false);
      setShowDisclaimer(true);
    }}
    className="w-full py-2.5 rounded-xl bg-gray-200 text-black font-semibold hover:bg-gray-300 transition"
  >
    Terms & Disclosures
  </button>

  <button
    onClick={handleLogout}
    className={menuBtnDangerClass}
  >
    Logout
  </button>
</div>
          </div>
        </div>
      </div>
    </div>
  );
}