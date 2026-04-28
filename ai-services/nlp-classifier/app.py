from fastapi import FastAPI, Request
from pydantic import BaseModel
from typing import List, Optional
import joblib
import re
import os
import subprocess
import sys
import json
import requests
from pathlib import Path
from transformers import pipeline

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = os.getenv("MODEL_PATH", "model/classifier.pkl")
VECTORIZER_PATH = os.getenv("VECTORIZER_PATH", "model/vectorizer.pkl")
INTENT_MODEL_PATH = os.getenv("INTENT_MODEL_PATH", "model/intent_classifier.pkl")

AI_TIER = os.getenv("AI_TIER", "free").strip().lower()  # "free" | "premium"
AI_AUTO_TRAIN = os.getenv("AI_AUTO_TRAIN", "").strip().lower() in ("1", "true", "yes", "on")
AI_EMBED_PROVIDER = os.getenv("AI_EMBED_PROVIDER", "local").strip().lower()  # "local" | "hf"

# Optional cloud fallback
CLOUD_PROVIDER = os.getenv("AI_CLOUD_PROVIDER", "").strip().lower()  # "hf" | "openai"
HF_API_TOKEN = os.getenv("HF_API_TOKEN", "").strip()
HF_MODEL = os.getenv("HF_MODEL", "mistralai/Mistral-7B-Instruct-v0.2").strip()
HF_EMBED_MODEL = os.getenv("HF_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2").strip()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
try:
    CLOUD_CONFIDENCE_THRESHOLD = float(os.getenv("AI_CLOUD_CONFIDENCE_THRESHOLD", "0.65"))
except Exception:
    CLOUD_CONFIDENCE_THRESHOLD = 0.65
try:
    CLOUD_TIMEOUT_SECONDS = float(os.getenv("AI_CLOUD_TIMEOUT_SECONDS", "10"))
except Exception:
    CLOUD_TIMEOUT_SECONDS = 10.0

LOCAL_HF_ENABLED = os.getenv("AI_LOCAL_HF_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")
LOCAL_HF_MODEL = os.getenv("AI_LOCAL_HF_MODEL", "typeform/distilbert-base-uncased-mnli").strip()
try:
    LOCAL_HF_TRIGGER_THRESHOLD = float(os.getenv("AI_LOCAL_HF_TRIGGER_THRESHOLD", "0.55"))
except Exception:
    LOCAL_HF_TRIGGER_THRESHOLD = 0.55
try:
    LOCAL_HF_MIN_SCORE = float(os.getenv("AI_LOCAL_HF_MIN_SCORE", "0.60"))
except Exception:
    LOCAL_HF_MIN_SCORE = 0.60
LOCAL_HF_ALWAYS = os.getenv("AI_LOCAL_HF_ALWAYS", "").strip().lower() in ("1", "true", "yes", "on")
try:
    LOCAL_HF_OVERRIDE_DELTA = float(os.getenv("AI_LOCAL_HF_OVERRIDE_DELTA", "0.12"))
except Exception:
    LOCAL_HF_OVERRIDE_DELTA = 0.12

def _resolve_path(path: str) -> Path:
    p = Path(path)
    if p.is_absolute():
        return p
    return BASE_DIR / p

MODEL_FILE = _resolve_path(MODEL_PATH)
VECTORIZER_FILE = _resolve_path(VECTORIZER_PATH)
INTENT_MODEL_FILE = _resolve_path(INTENT_MODEL_PATH)

def _maybe_auto_train():
    if not AI_AUTO_TRAIN:
        return
    missing = not (MODEL_FILE.exists() and VECTORIZER_FILE.exists() and INTENT_MODEL_FILE.exists())
    if not missing:
        return
    try:
        train_path = BASE_DIR / "train.py"
        data_path = BASE_DIR / "data" / "train.jsonl"
        csv_path = BASE_DIR / "data" / "email_training_dataset.csv"
        out_dir = MODEL_FILE.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                sys.executable,
                str(train_path),
                "--data",
                str(data_path),
                "--csv",
                str(csv_path),
                "--out-dir",
                str(out_dir),
            ],
            check=False,
        )
    except Exception as e:
        print(f"Auto-train failed: {e}")

# Try to load models
model = None
intent_model = None
vectorizer = None

hf_zero_shot = None

try:
    _maybe_auto_train()
    if MODEL_FILE.exists() and VECTORIZER_FILE.exists():
        model = joblib.load(MODEL_FILE)
        vectorizer = joblib.load(VECTORIZER_FILE)
        print(f"Successfully loaded model from {MODEL_PATH}")
    else:
        print(f"Model files not found. Using fallback classification.")
        print(f"Expected: {MODEL_PATH}, {VECTORIZER_PATH}")

    if INTENT_MODEL_FILE.exists():
        intent_model = joblib.load(INTENT_MODEL_FILE)
        print(f"Successfully loaded intent model from {INTENT_MODEL_PATH}")

    if LOCAL_HF_ENABLED:
        hf_zero_shot = pipeline("zero-shot-classification", model=LOCAL_HF_MODEL)
        print(f"Successfully loaded local HF model: {LOCAL_HF_MODEL}")
except Exception as e:
    print(f"Failed to load model: {e}")
    print("Using fallback classification.")

class PredictRequest(BaseModel):
    text: str

class PredictResponse(BaseModel):
    category: str
    intent: str
    confidence: float

class EnrichRequest(BaseModel):
    text: str

class EnrichResponse(BaseModel):
    category: str
    intent: str
    confidence: float
    summary: str
    priority: str
    keywords: List[str]
    entities: dict
    auto_resolvable: bool
    suggested_workflow: Optional[str] = None
    approval_title: Optional[str] = None
    approval_body: Optional[str] = None
    sentiment_score: float
    sentiment_label: str

def analyze_sentiment(text: str):
    t = (text or "").lower()
    negative = [
        "angry","frustrated","annoyed","upset","hate","terrible","worst","useless","broken","disappointed",
        "not working","can't","cannot","can not","urgent","asap","immediately","blocked","stuck","failed",
    ]
    positive = ["thanks","thank you","great","awesome","good","works now","resolved","fixed"]
    score = 0.0
    for w in negative:
        if w in t:
            score -= 0.12
    for w in positive:
        if w in t:
            score += 0.08
    score = max(-1.0, min(1.0, score))
    if score <= -0.35:
        label = "NEGATIVE"
    elif score >= 0.25:
        label = "POSITIVE"
    else:
        label = "NEUTRAL"
    return float(round(score, 3)), label

def clean_text(text: str) -> str:
    text = text.lower()
    # Enhanced text cleaning with better normalization
    text = re.sub(r"can't|cannot|couldn't", "can not", text)
    text = re.sub(r"won't|wont", "will not", text)
    text = re.sub(r"don't|dont", "do not", text)
    text = re.sub(r"isn't|isnt", "is not", text)
    text = re.sub(r"aren't|arent", "are not", text)
    text = re.sub(r"doesn't|doesnt", "does not", text)
    text = re.sub(r"didn't|didnt", "did not", text)
    text = re.sub(r"haven't|havent", "have not", text)
    text = re.sub(r"hasn't|hasnt", "has not", text)
    text = re.sub(r"hadn't|hadnt", "had not", text)
    text = re.sub(r"i'm|im", "i am", text)
    text = re.sub(r"it's|its", "it is", text)
    text = re.sub(r"you're|youre", "you are", text)
    text = re.sub(r"they're|theyre", "they are", text)
    text = re.sub(r"we're|were", "we are", text)
    text = re.sub(r"that's|thats", "that is", text)
    text = re.sub(r"there's|theres", "there is", text)
    text = re.sub(r"what's|whats", "what is", text)
    text = re.sub(r"where's|wheres", "where is", text)
    text = re.sub(r"how's|hows", "how is", text)
    text = re.sub(r"who's|whos", "who is", text)
    text = re.sub(r"when's|whens", "when is", text)
    text = re.sub(r"why's|whys", "why is", text)
    # Remove punctuation and extra spaces
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()

def is_security_text(text: str) -> bool:
    lower = text.lower()
    return any(
        k in lower
        for k in [
            "phishing",
            "suspicious",
            "malware",
            "ransomware",
            "virus",
            "trojan",
            "hack",
            "hacked",
            "breach",
            "data breach",
            "unauthorized",
            "security incident",
        ]
    )

def _extract_json_object(text: str) -> Optional[dict]:
    # Extract the first JSON object found in a possibly chatty model response.
    if not text:
        return None
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    chunk = m.group(0)
    try:
        return json.loads(chunk)
    except Exception:
        return None

_CATEGORIES = [
    "IDENTITY_ACCESS",
    "NETWORK_VPN_WIFI",
    "EMAIL_COLLAB",
    "ENDPOINT_DEVICE",
    "HARDWARE_PERIPHERAL",
    "SOFTWARE_INSTALL_LICENSE",
    "BUSINESS_APP_ERP_CRM",
    "SECURITY_INCIDENT",
    "KB_GENERAL",
    "OTHER",
]

_INTENTS = [
    "INCIDENT",
    "SERVICE_REQUEST",
    "CHANGE",
    "PROBLEM",
    "HOW_TO",
    "SECURITY_REPORT",
    "PASSWORD_RESET",
    "ACCOUNT_UNLOCK",
    "UNKNOWN",
]

_CATEGORY_LABELS = {
    "IDENTITY_ACCESS": "Identity and access (password, login, account, MFA)",
    "NETWORK_VPN_WIFI": "Network, VPN, or WiFi connectivity",
    "EMAIL_COLLAB": "Email, Outlook, or collaboration tools",
    "ENDPOINT_DEVICE": "Endpoint device or OS issues",
    "HARDWARE_PERIPHERAL": "Hardware or peripherals (printer, monitor, keyboard)",
    "SOFTWARE_INSTALL_LICENSE": "Software install, update, or licensing",
    "BUSINESS_APP_ERP_CRM": "Business apps (ERP/CRM/SAP/Oracle)",
    "SECURITY_INCIDENT": "Security incident, phishing, or malware",
    "KB_GENERAL": "How-to or general knowledge base",
    "OTHER": "Other or unclear IT issue",
}

_INTENT_LABELS = {
    "INCIDENT": "Incident or service disruption",
    "SERVICE_REQUEST": "Service request or access request",
    "CHANGE": "Change request",
    "PROBLEM": "Problem investigation or root cause",
    "HOW_TO": "How-to or guidance",
    "SECURITY_REPORT": "Security incident report",
    "PASSWORD_RESET": "Password reset request",
    "ACCOUNT_UNLOCK": "Account unlock request",
    "UNKNOWN": "Unknown or unclear intent",
}

_INTENT_ALIASES = {
    "ACCOUNT_ACCESS": "PASSWORD_RESET",
    "ACCOUNT_RESET": "PASSWORD_RESET",
    "ACCOUNT_LOCKED": "ACCOUNT_UNLOCK",
}

def _normalize_label(value: str, label_map: dict) -> Optional[str]:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    upper = raw.upper().replace(" ", "_")
    if upper in label_map:
        return upper
    if upper in _INTENT_ALIASES and _INTENT_ALIASES[upper] in label_map:
        return _INTENT_ALIASES[upper]
    reverse = {v: k for k, v in label_map.items()}
    if raw in reverse:
        return reverse[raw]
    if raw.title() in reverse:
        return reverse[raw.title()]
    return None

def _local_hf_enrich(text: str) -> Optional[dict]:
    if not hf_zero_shot:
        return None
    try:
        cat_labels = list(_CATEGORY_LABELS.values())
        it_labels = list(_INTENT_LABELS.values())
        cat_res = hf_zero_shot(
            text,
            candidate_labels=cat_labels,
            multi_label=False,
            hypothesis_template="This IT ticket is about {}.",
        )
        it_res = hf_zero_shot(
            text,
            candidate_labels=it_labels,
            multi_label=False,
            hypothesis_template="The intent is {}.",
        )

        cat = cat_res.get("labels", [None])[0]
        cat_score = cat_res.get("scores", [0.0])[0]
        it = it_res.get("labels", [None])[0]
        it_score = it_res.get("scores", [0.0])[0]

        if not isinstance(cat, str) or not isinstance(it, str):
            return None
        if not isinstance(cat_score, (int, float)) or not isinstance(it_score, (int, float)):
            return None

        cat_key = _normalize_label(cat, _CATEGORY_LABELS)
        it_key = _normalize_label(it, _INTENT_LABELS)
        if not cat_key or not it_key:
            return None

        confidence = float(max(cat_score, it_score))
        return {
            "category": cat_key,
            "intent": it_key,
            "confidence": confidence,
        }
    except Exception:
        return None

def _cloud_enabled(tier: str) -> bool:
    if tier != "premium":
        return False
    if CLOUD_PROVIDER == "hf":
        return bool(HF_API_TOKEN and HF_MODEL)
    if CLOUD_PROVIDER == "openai":
        return bool(OPENAI_API_KEY)
    return False

def _cloud_enrich(text: str, tier: str) -> Optional[dict]:
    # Returns partial enrichment: {category, intent, priority, confidence}
    # Must never raise.
    if not _cloud_enabled(tier):
        return None

    prompt = (
        "You are an IT support ticket classifier. Return ONLY valid JSON with keys: "
        "category, intent, priority, confidence.\n\n"
        "Allowed priority: LOW, MEDIUM, HIGH.\n"
        "Allowed intent: INCIDENT, SERVICE_REQUEST, CHANGE, PROBLEM, HOW_TO, SECURITY_REPORT, PASSWORD_RESET, ACCOUNT_UNLOCK, UNKNOWN.\n"
        "Allowed category: IDENTITY_ACCESS, NETWORK_VPN_WIFI, EMAIL_COLLAB, ENDPOINT_DEVICE, BUSINESS_APP_ERP_CRM, "
        "SOFTWARE_INSTALL_LICENSE, HARDWARE_PERIPHERAL, SECURITY_INCIDENT, KB_GENERAL, OTHER.\n\n"
        f"Ticket:\n{text}\n"
    )

    try:
        if CLOUD_PROVIDER == "hf":
            url = f"https://api-inference.huggingface.co/models/{HF_MODEL}"
            headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
            payload = {
                "inputs": prompt,
                "parameters": {"max_new_tokens": 180, "temperature": 0.2, "return_full_text": False},
            }
            res = requests.post(url, headers=headers, json=payload, timeout=CLOUD_TIMEOUT_SECONDS)
            if not res.ok:
                return None
            data = res.json()
            # Common response: [{"generated_text": "..."}]
            if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                text_out = data[0].get("generated_text")
                if isinstance(text_out, str):
                    return _extract_json_object(text_out)
            # Sometimes HF returns dict errors
            return None

        if CLOUD_PROVIDER == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}",
            }
            payload = {
                "model": OPENAI_MODEL,
                "messages": [
                    {"role": "system", "content": "Return ONLY JSON. No markdown."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "max_tokens": 200,
            }
            res = requests.post(url, headers=headers, json=payload, timeout=CLOUD_TIMEOUT_SECONDS)
            if not res.ok:
                return None
            data = res.json()
            content = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content")
            )
            if isinstance(content, str):
                return _extract_json_object(content) or _extract_json_object(content.strip())
            return None

        return None
    except Exception:
        return None

def _mean_pool(matrix: list) -> Optional[list]:
    if not matrix or not isinstance(matrix, list):
        return None
    if not isinstance(matrix[0], list):
        return None
    dims = len(matrix[0])
    if dims == 0:
        return None
    sums = [0.0] * dims
    count = 0
    for row in matrix:
        if not isinstance(row, list) or len(row) != dims:
            continue
        for i, v in enumerate(row):
            if isinstance(v, (int, float)):
                sums[i] += float(v)
        count += 1
    if count == 0:
        return None
    return [v / count for v in sums]

def _hf_embed(text: str) -> Optional[list]:
    if not (HF_API_TOKEN and HF_EMBED_MODEL):
        return None
    try:
        url = f"https://api-inference.huggingface.co/models/{HF_EMBED_MODEL}"
        headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
        payload = {"inputs": text, "options": {"wait_for_model": True}}
        res = requests.post(url, headers=headers, json=payload, timeout=CLOUD_TIMEOUT_SECONDS)
        if not res.ok:
            return None
        data = res.json()
        if isinstance(data, list):
            if len(data) == 0:
                return None
            if isinstance(data[0], (int, float)):
                return [float(x) for x in data]
            pooled = _mean_pool(data)
            if pooled:
                return pooled
        return None
    except Exception:
        return None

app = FastAPI(title="AI NLP Classifier", version="1.0.0")

def fallback_classify(text: str) -> PredictResponse:
    """Enhanced fallback classification with sophisticated keyword analysis and context understanding"""
    text_lower = text.lower()
    original_text = text

    # Initialize scoring system
    category_scores = {cat: 0.0 for cat in _CATEGORIES}
    intent_scores = {intent: 0.0 for intent in _INTENTS}

    # Enhanced keyword mapping with weights and context
    keyword_mappings = {
        "IDENTITY_ACCESS": {
            "high_weight": ["password reset", "forgot password", "account locked", "cannot login", "login failed", "access denied", "account unlock", "reset password"],
            "medium_weight": ["password", "login", "account", "access", "username", "credential", "authentication", "sign in", "log in"],
            "low_weight": ["user", "profile", "permission", "role"]
        },
        "NETWORK_VPN_WIFI": {
            "high_weight": ["vpn connection", "cannot connect vpn", "vpn failed", "wifi not working", "no internet", "network issue", "connection timeout", "vpn error"],
            "medium_weight": ["vpn", "wifi", "network", "internet", "connection", "connect", "wireless", "router", "gateway"],
            "low_weight": ["slow", "unstable", "disconnect", "reconnect"]
        },
        "EMAIL_COLLAB": {
            "high_weight": ["email not sending", "cannot send email", "email not receiving", "cannot receive email", "outlook not working", "mailbox full"],
            "medium_weight": ["email", "outlook", "mail", "calendar", "meeting", "attachment", "send", "receive"],
            "low_weight": ["compose", "inbox", "sent", "draft"]
        },
        "HARDWARE_PERIPHERAL": {
            "high_weight": ["printer not working", "cannot print", "scanner issue", "monitor not working", "keyboard not working", "mouse not working"],
            "medium_weight": ["printer", "scanner", "monitor", "keyboard", "mouse", "laptop", "computer", "screen", "display", "hardware"],
            "low_weight": ["broken", "damaged", "faulty", "stuck", "unresponsive"]
        },
        "SOFTWARE_INSTALL_LICENSE": {
            "high_weight": ["software installation failed", "cannot install software", "license expired", "license invalid", "activation failed"],
            "medium_weight": ["install", "software", "application", "program", "license", "activation", "update", "upgrade"],
            "low_weight": ["download", "setup", "configuration", "version"]
        },
        "BUSINESS_APP_ERP_CRM": {
            "high_weight": ["sap not working", "oracle error", "crm login failed", "erp system down", "salesforce issue"],
            "medium_weight": ["sap", "oracle", "crm", "erp", "salesforce", "business application", "enterprise"],
            "low_weight": ["module", "transaction", "report", "dashboard"]
        },
        "SECURITY_INCIDENT": {
            "high_weight": ["phishing email", "suspicious attachment", "malware detected", "ransomware attack", "data breach", "security incident"],
            "medium_weight": ["phishing", "malware", "virus", "hack", "breach", "security", "suspicious", "unauthorized"],
            "low_weight": ["threat", "attack", "compromised", "incident"]
        },
        "KB_GENERAL": {
            "high_weight": ["how do i", "how to", "step by step", "guide needed", "instructions for", "tutorial"],
            "medium_weight": ["how", "guide", "tutorial", "instruction", "help", "learn"],
            "low_weight": ["please explain", "can you tell me", "i need to know"]
        }
    }

    # Score categories based on keyword matches
    for category, keywords in keyword_mappings.items():
        # High weight keywords (3 points)
        for keyword in keywords["high_weight"]:
            if keyword in text_lower:
                category_scores[category] += 3.0

        # Medium weight keywords (2 points)
        for keyword in keywords["medium_weight"]:
            if keyword in text_lower:
                category_scores[category] += 2.0

        # Low weight keywords (1 point)
        for keyword in keywords["low_weight"]:
            if keyword in text_lower:
                category_scores[category] += 1.0

    # Intent analysis
    intent_keywords = {
        "INCIDENT": ["not working", "broken", "failed", "error", "cannot", "unable", "issue", "problem", "down", "crash"],
        "SERVICE_REQUEST": ["request", "need", "want", "please provide", "can i get", "install", "setup", "configure"],
        "HOW_TO": ["how do i", "how to", "how can i", "steps", "guide", "tutorial", "instructions"],
        "SECURITY_REPORT": ["phishing", "suspicious", "malware", "security", "breach", "unauthorized"],
        "ACCOUNT_ACCESS": ["password", "login", "account", "access", "unlock", "reset"],
        "PASSWORD_RESET": ["forgot password", "reset password", "password reset"],
        "ACCOUNT_UNLOCK": ["account locked", "unlock account", "lockout"]
    }

    for intent, keywords in intent_keywords.items():
        for keyword in keywords:
            if keyword in text_lower:
                intent_scores[intent] += 2.0

    # Context-aware scoring adjustments
    if "urgent" in text_lower or "asap" in text_lower or "immediately" in text_lower:
        intent_scores["INCIDENT"] += 1.5

    if "please" in text_lower or "could you" in text_lower or "can you" in text_lower:
        intent_scores["SERVICE_REQUEST"] += 1.0

    # Find best category and intent
    best_category = max(category_scores.items(), key=lambda x: x[1])
    best_intent = max(intent_scores.items(), key=lambda x: x[1])

    # Calculate confidence based on score difference and keyword matches
    category_scores_list = sorted(category_scores.values(), reverse=True)
    intent_scores_list = sorted(intent_scores.values(), reverse=True)

    category_confidence = min(0.95, 0.6 + (best_category[1] * 0.1))
    intent_confidence = min(0.95, 0.6 + (best_intent[1] * 0.1))

    # If there's a clear winner, increase confidence
    if category_scores_list[0] > category_scores_list[1] * 1.5:
        category_confidence = min(0.98, category_confidence + 0.1)
    if intent_scores_list[0] > intent_scores_list[1] * 1.5:
        intent_confidence = min(0.98, intent_confidence + 0.1)

    # Security override (highest priority)
    if is_security_text(original_text):
        return PredictResponse(category="SECURITY_INCIDENT", intent="SECURITY_REPORT", confidence=0.95)

    final_confidence = (category_confidence + intent_confidence) / 2

    return PredictResponse(
        category=best_category[0] if best_category[1] > 0 else "OTHER",
        intent=best_intent[0] if best_intent[1] > 0 else "UNKNOWN",
        confidence=round(final_confidence, 3)
    )

def extract_keywords(text: str) -> List[str]:
    lower = text.lower()
    candidates = [
        "password", "reset", "unlock", "locked", "login", "access",
        "vpn", "wifi", "network", "internet", "connection",
        "email", "outlook", "mail", "calendar",
        "printer", "print", "laptop", "computer", "screen", "mouse", "keyboard",
        "install", "software", "update", "license",
        "phishing", "malware", "security", "virus", "hack",
        "sap", "oracle", "crm", "erp",
        "urgent", "critical", "down", "broken", "error",
    ]
    out: List[str] = []
    for c in candidates:
        if c in lower and c not in out:
            out.append(c)
    return out[:20]

def extract_entities(text: str) -> dict:
    entities = {
        "emails": [],
        "usernames": [],
        "asset_tags": [],
        "error_codes": [],
    }

    emails = re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", text)
    entities["emails"] = list(dict.fromkeys([e.lower() for e in emails]))[:5]

    for m in re.finditer(r"\b(username|user id|userid)\s*[:=]?\s*([a-zA-Z0-9._-]{3,})\b", text, re.IGNORECASE):
        entities["usernames"].append(m.group(2))
    entities["usernames"] = list(dict.fromkeys(entities["usernames"]))[:5]

    asset = re.findall(r"\b([A-Z]{2,5}-\d{3,10})\b", text)
    entities["asset_tags"] = list(dict.fromkeys(asset))[:5]

    errs = re.findall(r"\b(0x[0-9A-Fa-f]+|ERR_[A-Z0-9_]+|\d{3,5})\b", text)
    entities["error_codes"] = list(dict.fromkeys(errs))[:5]

    return entities

def guess_priority(text: str) -> str:
    lower = text.lower()
    if any(
        k in lower
        for k in [
            "phishing",
            "suspicious",
            "malware",
            "ransomware",
            "virus",
            "trojan",
            "hack",
            "hacked",
            "breach",
            "data breach",
            "unauthorized",
            "security incident",
        ]
    ):
        return "HIGH"
    if any(k in lower for k in ["urgent", "critical", "down", "outage", "cannot work", "blocked"]):
        return "HIGH"
    if any(k in lower for k in ["can't", "cannot", "not working", "error"]):
        return "MEDIUM"
    return "LOW"

def suggest_workflow(text: str, category: str) -> tuple[bool, Optional[str], Optional[str], Optional[str]]:
    lower = text.lower()
    if any(kw in lower for kw in ["password", "reset", "forgot"]):
        return True, "PASSWORD_RESET", "Confirm password reset", "AI can reset your password and send a reset notification. Approve to proceed."
    if any(kw in lower for kw in ["account", "unlock", "locked", "lockout"]):
        return True, "ACCOUNT_UNLOCK", "Confirm account unlock", "AI can unlock your account. Approve to proceed."
    if category == "NETWORK_VPN_WIFI" and any(kw in lower for kw in ["vpn", "connect", "connection"]):
        return True, "VPN_BASIC_FIX", "Confirm VPN troubleshooting", "AI can run automated VPN connectivity checks and guide you through fixes. Approve to proceed."
    if category == "HARDWARE_PERIPHERAL" and any(kw in lower for kw in ["printer", "print"]):
        return True, "PRINTER_TROUBLESHOOT", "Confirm printer troubleshooting", "AI can run printer troubleshooting steps and guide you. Approve to proceed."
    return False, None, None, None

def make_summary(text: str) -> str:
    clean = re.sub(r"\s+", " ", text.strip())
    if len(clean) <= 160:
        return clean
    return clean[:157] + "..."

def _tier_from_request(req: Request) -> str:
    header = req.headers.get("x-ai-tier", "").strip().lower()
    if header in ("free", "premium"):
        return header
    return AI_TIER if AI_TIER in ("free", "premium") else "free"

@app.post("/predict", response_model=PredictResponse)
@app.post("/", response_model=PredictResponse)  # Also support root endpoint for backward compatibility
def predict(req: PredictRequest, request: Request):
    if not model or not vectorizer:
        # Use fallback classification
        return fallback_classify(req.text)
    
    cleaned = clean_text(req.text)
    X = vectorizer.transform([cleaned])
    pred = model.predict(X)[0]

    pred_intent = "classify"
    intent_prob = None
    if intent_model is not None:
        try:
            pred_intent = str(intent_model.predict(X)[0])
            if hasattr(intent_model, "predict_proba"):
                intent_prob = float(max(intent_model.predict_proba(X)[0]))
        except Exception:
            pred_intent = "classify"
    try:
        prob = float(max(model.predict_proba(X)[0]))
    except Exception:
        prob = 0.5
    if isinstance(intent_prob, (int, float)):
        prob = float((prob + intent_prob) / 2)

    if is_security_text(req.text):
        return PredictResponse(category="SECURITY_INCIDENT", intent="SECURITY_REPORT", confidence=max(round(prob, 3), 0.85))

    return PredictResponse(category=pred, intent=pred_intent, confidence=round(prob, 3))

@app.post("/enrich", response_model=EnrichResponse)
def enrich(req: EnrichRequest, request: Request):
    tier = _tier_from_request(request)
    base = predict(PredictRequest(text=req.text), request)
    summary = make_summary(req.text)
    keywords = extract_keywords(req.text)
    entities = extract_entities(req.text)
    priority = guess_priority(req.text)
    sentiment_score, sentiment_label = analyze_sentiment(req.text)

    if not is_security_text(req.text):
        use_local = bool(hf_zero_shot) and (LOCAL_HF_ALWAYS or base.confidence < LOCAL_HF_TRIGGER_THRESHOLD)
        if use_local:
            local = _local_hf_enrich(req.text)
            if isinstance(local, dict) and float(local.get("confidence", 0.0)) >= LOCAL_HF_MIN_SCORE:
                cat = local.get("category")
                it = local.get("intent")
                cf = local.get("confidence")
                if isinstance(cat, str) and isinstance(it, str) and isinstance(cf, (int, float)):
                    if (cf >= base.confidence + LOCAL_HF_OVERRIDE_DELTA) or (base.confidence < LOCAL_HF_TRIGGER_THRESHOLD):
                        base.category = cat
                        base.intent = it
                        base.confidence = float(cf)
                    elif cat == base.category and it == base.intent:
                        # Agreement boost
                        base.confidence = float(max(base.confidence, cf))

        if base.confidence < CLOUD_CONFIDENCE_THRESHOLD:
            cloud = _cloud_enrich(req.text, tier)
            if isinstance(cloud, dict):
                cat = _normalize_label(cloud.get("category"), _CATEGORY_LABELS)
                it = _normalize_label(cloud.get("intent"), _INTENT_LABELS)
                pr = cloud.get("priority")
                cf = cloud.get("confidence")

                if cat:
                    base.category = cat
                if it:
                    base.intent = it
                if pr in ("LOW", "MEDIUM", "HIGH"):
                    priority = pr
                if isinstance(cf, (int, float)):
                    try:
                        base.confidence = float(cf)
                    except Exception:
                        pass

    auto_resolvable, wf, at, ab = suggest_workflow(req.text, base.category)
    return EnrichResponse(
        category=base.category,
        intent=base.intent,
        confidence=base.confidence,
        summary=summary,
        priority=priority,
        keywords=keywords,
        entities=entities,
        auto_resolvable=auto_resolvable,
        suggested_workflow=wf,
        approval_title=at,
        approval_body=ab,
        sentiment_score=sentiment_score,
        sentiment_label=sentiment_label,
    )

@app.get("/")
def health():
    return {"status": "ok"}

# Embedding model for RAG (lazy loaded)
_embedding_model = None

def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            print("Loaded embedding model: all-MiniLM-L6-v2")
        except Exception as e:
            print(f"Failed to load embedding model: {e}")
            return None
    return _embedding_model

class EmbedRequest(BaseModel):
    text: str

class EmbedResponse(BaseModel):
    embedding: List[float]
    model: str
    dimensions: int

@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest, request: Request):
    tier = _tier_from_request(request)
    provider = AI_EMBED_PROVIDER
    if tier != "premium":
        provider = "local"

    if provider == "hf":
        emb = _hf_embed(req.text)
        if isinstance(emb, list) and len(emb) > 0:
            return EmbedResponse(
                embedding=emb,
                model=HF_EMBED_MODEL,
                dimensions=len(emb),
            )

    model = get_embedding_model()
    if model is None:
        # Fallback: return zero vector if model not available
        return EmbedResponse(
            embedding=[0.0] * 384,
            model="none",
            dimensions=384
        )

    # Generate embedding
    embedding = model.encode(req.text, normalize_embeddings=True)
    return EmbedResponse(
        embedding=embedding.tolist(),
        model="all-MiniLM-L6-v2",
        dimensions=len(embedding)
    )

class SemanticSearchRequest(BaseModel):
    query: str
    top_k: int = 5

class SemanticSearchResult(BaseModel):
    query_embedding: List[float]
    top_k: int

@app.post("/semantic-search", response_model=SemanticSearchResult)
def semantic_search(req: SemanticSearchRequest):
    model = get_embedding_model()
    if model is None:
        return SemanticSearchResult(
            query_embedding=[0.0] * 384,
            top_k=req.top_k
        )
    
    # Generate query embedding
    embedding = model.encode(req.query, normalize_embeddings=True)
    return SemanticSearchResult(
        query_embedding=embedding.tolist(),
        top_k=req.top_k
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
