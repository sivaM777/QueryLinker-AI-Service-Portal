#!/usr/bin/env python3
"""
Baseline training script for IT ticket classification.
Generates classifier.pkl and vectorizer.pkl from JSONL training data.
"""

import json
import re
import csv
from pathlib import Path
from typing import Dict, List

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, accuracy_score

# === Intent taxonomy (closed set) ===
INTENT_MAP = {
    "INCIDENT": "INCIDENT",
    "SERVICE_REQUEST": "SERVICE_REQUEST",
    "HOW_TO": "HOW_TO",
    "SECURITY_REPORT": "SECURITY_REPORT",
    "ACCOUNT_ACCESS": "ACCOUNT_ACCESS",
    "CHANGE": "CHANGE",
    "PROBLEM": "PROBLEM",
    "UNKNOWN": "UNKNOWN",
}

# === Domain mapping ===
DOMAIN_MAP = {
    "IDENTITY_ACCESS": "IDENTITY_ACCESS",
    "NETWORK_VPN_WIFI": "NETWORK_VPN_WIFI",
    "EMAIL_COLLAB": "EMAIL_COLLAB",
    "ENDPOINT_DEVICE": "ENDPOINT_DEVICE",
    "BUSINESS_APP_ERP_CRM": "BUSINESS_APP_ERP_CRM",
    "SOFTWARE_INSTALL_LICENSE": "SOFTWARE_INSTALL_LICENSE",
    "HARDWARE_PERIPHERAL": "HARDWARE_PERIPHERAL",
    "SECURITY_INCIDENT": "SECURITY_INCIDENT",
    "KB_GENERAL": "KB_GENERAL",
    "OTHER": "OTHER",
}

# === Risk levels ===
RISK_MAP = {
    "LOW": "LOW",
    "MEDIUM": "MEDIUM",
    "HIGH": "HIGH",
    "CRITICAL": "CRITICAL",
}

# === Security escalation keywords ===
SECURITY_KEYWORDS = [
    "phishing", "malware", "ransomware", "stolen", "lost", "compromised",
    "suspicious", "unauthorized", "fraud", "breach", "attack", "hacked",
]

def is_security_issue(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in SECURITY_KEYWORDS)

def clean_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", "", text)
    return text

def load_jsonl(path: str) -> List[Dict]:
    if not Path(path).exists():
        raise FileNotFoundError(f"Training data not found: {path}")
    data = []
    # Note: some generators (e.g. PowerShell) may write UTF-8 BOM.
    # Use utf-8-sig and also strip BOM characters defensively per-line.
    with open(path, "r", encoding="utf-8-sig") as f:
        for line in f:
            if line.strip():
                cleaned = line.lstrip("\ufeff")
                obj = json.loads(cleaned)
                if "text" in obj and "intent" in obj and "domain" in obj:
                    data.append(obj)
    return data

def load_jsonl_optional(paths: List[str]) -> List[Dict]:
    out: List[Dict] = []
    for p in paths:
        if Path(p).exists():
            out.extend(load_jsonl(p))
    return out

def _map_subcategory_to_intent(subcategory: str) -> str:
    sub = (subcategory or "").strip().lower()
    if sub in ("incident", "outage", "downtime"):
        return "INCIDENT"
    if sub in ("request", "service_request", "service request"):
        return "SERVICE_REQUEST"
    if sub in ("change", "change_request", "change request"):
        return "CHANGE"
    if sub in ("problem", "rca"):
        return "PROBLEM"
    if sub in ("otp", "marketing", "spam", "noreply", "notification"):
        return "UNKNOWN"
    return "UNKNOWN"

def _map_subcategory_to_domain(subcategory: str, text: str) -> str:
    sub = (subcategory or "").strip().lower()
    if sub in ("otp", "marketing", "spam", "noreply", "notification"):
        return "OTHER"
    t = (text or "").lower()
    if any(k in t for k in ["vpn", "wifi", "network", "gateway", "load balancer"]):
        return "NETWORK_VPN_WIFI"
    if any(k in t for k in ["password", "login", "unlock", "account"]):
        return "IDENTITY_ACCESS"
    if any(k in t for k in ["email", "outlook", "mailbox", "calendar"]):
        return "EMAIL_COLLAB"
    if any(k in t for k in ["printer", "scan", "scanner", "keyboard", "mouse", "monitor"]):
        return "HARDWARE_PERIPHERAL"
    if any(k in t for k in ["install", "license", "activation", "setup"]):
        return "SOFTWARE_INSTALL_LICENSE"
    if any(k in t for k in ["sap", "oracle", "crm", "erp", "salesforce"]):
        return "BUSINESS_APP_ERP_CRM"
    return "OTHER"

def load_csv_dataset(path: str) -> List[Dict]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"CSV training data not found: {path}")
    out: List[Dict] = []
    with open(p, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            subject = str(row.get("subject") or "").strip()
            body = str(row.get("body") or "").strip()
            category = str(row.get("category") or "").strip().lower()
            subcategory = str(row.get("subcategory") or "").strip().lower()

            text = (subject + "\n\n" + body).strip()
            if not text:
                continue

            # Map the dataset schema into the classifier's schema.
            # NOTE: This classifier only supports a closed-set intent taxonomy.
            # We treat non-ticket and non-IT categories as UNKNOWN intent.
            if category != "ticket":
                intent = "UNKNOWN"
                domain = "OTHER"
            else:
                intent = _map_subcategory_to_intent(subcategory)
                domain = _map_subcategory_to_domain(subcategory, text)

            out.append({
                "text": text,
                "intent": intent,
                "domain": domain,
            })
    return out

def pick_domain(record: Dict) -> str:
    domain = str(record.get("domain") or "OTHER")
    if domain not in DOMAIN_MAP:
        return "OTHER"
    return domain

def pick_intent(record: Dict) -> str:
    intent = str(record.get("intent") or "UNKNOWN")
    if intent not in INTENT_MAP:
        return "UNKNOWN"
    return intent

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Train baseline IT ticket classifier")
    parser.add_argument("--data", type=str, default="data/train.jsonl", help="Path to JSONL training data")
    parser.add_argument("--csv", type=str, default="", help="Optional CSV dataset path (subject,body,category,subcategory)")
    parser.add_argument("--out-dir", type=str, default="model", help="Output directory for model artifacts")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Loading training data...")
    generated = str(Path(args.data).parent / "train.generated.jsonl")
    raw = load_jsonl_optional([args.data, generated])
    if args.csv:
        raw.extend(load_csv_dataset(args.csv))
    if not raw:
        print("No valid training samples found.")
        return

    texts: List[str] = []
    domains: List[str] = []
    intents: List[str] = []
    risks: List[str] = []

    for r in raw:
        text = str(r.get("text") or "").strip()
        if not text:
            continue
        domain = pick_domain(r)
        intent = pick_intent(r)

        if is_security_issue(text):
            domain = "SECURITY_INCIDENT"
            intent = "SECURITY_REPORT"
            risk = "HIGH"
        else:
            risk = str(r.get("risk") or "MEDIUM")
            if risk not in RISK_MAP:
                risk = "MEDIUM"

        texts.append(clean_text(text))
        domains.append(domain)
        intents.append(intent)
        risks.append(risk)

    if len(texts) < 5:
        print("Not enough samples to train. Add more rows to data/train.jsonl")
        return

    vectorizer = TfidfVectorizer(max_features=5000, ngram_range=(1, 2))
    X = vectorizer.fit_transform(texts)

    domain_clf = LogisticRegression(max_iter=1500, class_weight="balanced")
    domain_clf.fit(X, domains)

    intent_clf = LogisticRegression(max_iter=1500, class_weight="balanced")
    intent_clf.fit(X, intents)

    preds = domain_clf.predict(X)
    print("\nDomain classification report (train-set; add real data for proper eval):")
    print(classification_report(domains, preds, zero_division=0))

    intent_preds = intent_clf.predict(X)
    print("\nIntent classification report (train-set; add real data for proper eval):")
    print(classification_report(intents, intent_preds, zero_division=0))

    joblib.dump(domain_clf, out_dir / "classifier.pkl")
    joblib.dump(intent_clf, out_dir / "intent_classifier.pkl")
    joblib.dump(vectorizer, out_dir / "vectorizer.pkl")

    # Save metrics for quick verification (train-set only)
    metrics = {
        "domain": {
            "accuracy": float(accuracy_score(domains, preds)),
            "report": classification_report(domains, preds, zero_division=0, output_dict=True),
        },
        "intent": {
            "accuracy": float(accuracy_score(intents, intent_preds)),
            "report": classification_report(intents, intent_preds, zero_division=0, output_dict=True),
        },
        "note": "Metrics are on the training set only. Use a held-out dataset for real accuracy.",
    }
    with open(out_dir / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=True, indent=2)

    print(f"Model artifacts saved to {out_dir}")

if __name__ == "__main__":
    main()
