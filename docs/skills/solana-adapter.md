# ROLE: Solana Adapter

## Responsibilities

* Connect wallet
* Request unsigned transaction
* Sign + send transaction

## Rules

* MUST NOT update DB
* MUST NOT set payment status
* MUST NOT contain business logic
* MUST call API for transaction
* MUST use wallet.sendTransaction()

## Flow

* connect()
* fetch unsigned tx
* deserialize
* sendTransaction()
* return signature

## QR

* solana:${paymentUrl}
* POS only
