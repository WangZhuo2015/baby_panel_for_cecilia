import os
import re
import csv
from pathlib import Path

REPO_ROOT = Path("/Users/wangzhuo/Documents/GitHub/baby_panel_for_cecilia")
OUTPUT_CSV = REPO_ROOT / "docs/compat/web-call-inventory.csv"

# 1. Collect all route files
route_files = sorted((REPO_ROOT / "app").rglob("route.ts"))

# 2. Cache test files
test_files = {}
for tf in (REPO_ROOT / "tests").rglob("*.test.ts"):
    rel_p = tf.relative_to(REPO_ROOT).as_posix()
    test_files[rel_p] = tf.read_text(encoding="utf-8", errors="ignore")

# 3. Cache caller files including stores!
caller_files = {}
for search_dir in ["app", "components", "lib", "hooks", "scripts", "stores"]:
    dir_path = REPO_ROOT / search_dir
    if not dir_path.exists():
        continue
    for cf in dir_path.rglob("*"):
        if cf.suffix in (".ts", ".tsx", ".js", ".mjs"):
            rel_p = cf.relative_to(REPO_ROOT).as_posix()
            try:
                caller_files[rel_p] = cf.read_text(encoding="utf-8", errors="ignore")
            except:
                pass

def get_callers(api_path, route_file_rel):
    base_search = api_path
    if "[" in api_path:
        base_search = api_path[:api_path.find("[")]
    callers = []
    for rel_p, content in caller_files.items():
        if rel_p == route_file_rel:
            continue
        # search exact quoted path
        pattern = r"['\"`]" + re.escape(base_search)
        if re.search(pattern, content):
            callers.append(rel_p)
    return sorted(callers)

def get_tests(api_path, route_file_rel):
    base_search = api_path
    if "[" in api_path:
        base_search = api_path[:api_path.find("[")]
    matches = []
    filename = Path(route_file_rel).name
    for test_rel, content in test_files.items():
        if base_search in content or filename in content or route_file_rel in content:
            matches.append(test_rel)
    return sorted(matches)

# Helper map for target operation IDs (prefixed with PROPOSED:)
def map_proposed_operation(method, path):
    op = "unknown"
    if path == "/api/auth/register": op = "register"
    elif path == "/api/auth/login": op = "login"
    elif path == "/api/auth/logout": op = "logout"
    elif path == "/api/auth/me": op = "getCurrentUser"
    elif path == "/api/family/join": op = "joinFamily"
    elif path == "/api/family/members": op = "listFamilyMembers"
    elif path == "/api/family/preview": op = "previewFamilyInvite"
    elif path == "/api/baby":
        if method == "GET": op = "listBabies"
        elif method == "POST": op = "createBaby"
        elif method == "PUT": op = "updateBaby"
    elif path == "/api/baby/avatar": op = "uploadBabyAvatar"
    elif path == "/api/records/timeline": op = "getBabyTimeline"
    elif path == "/api/records/daily-summary": op = "getRecordsDailySummary"
    elif path == "/api/records/feeding":
        if method == "GET": op = "listFeedingRecords"
        elif method == "POST": op = "createFeedingRecord"
        elif method == "PUT": op = "updateFeedingRecord"
        elif method == "DELETE": op = "deleteFeedingRecord"
    elif path == "/api/records/sleep":
        if method == "GET": op = "listSleepRecords"
        elif method == "POST": op = "createSleepRecord"
        elif method == "PUT": op = "updateSleepRecord"
        elif method == "DELETE": op = "deleteSleepRecord"
    elif path == "/api/records/diaper":
        if method == "GET": op = "listDiaperRecords"
        elif method == "POST": op = "createDiaperRecord"
        elif method == "PUT": op = "updateDiaperRecord"
        elif method == "DELETE": op = "deleteDiaperRecord"
    elif path == "/api/food/logs":
        if method == "GET": op = "listFoodRecords"
        elif method == "POST": op = "createFoodRecord"
        elif method == "PUT": op = "updateFoodRecord"
        elif method == "DELETE": op = "deleteFoodRecord"
    elif path == "/api/food/items":
        if method == "GET": op = "listFoodItems"
        elif method == "POST": op = "createFoodItem"
    elif path == "/api/food/plans":
        if method == "GET": op = "listFoodPlans"
        elif method == "POST": op = "createFoodPlan"
    elif path == "/api/food/feeding-guidelines": op = "getFeedingGuidelines"
    elif path == "/api/nutrition/analysis": op = "getNutritionAnalysis"
    elif path == "/api/nutrition/products":
        if method == "GET": op = "listNutritionProducts"
        elif method == "POST": op = "createNutritionProduct"
        elif method == "PUT": op = "updateNutritionProduct"
        elif method == "DELETE": op = "deleteNutritionProduct"
    elif path == "/api/nutrition/records":
        if method == "GET": op = "listSupplementRecords"
        elif method == "POST": op = "createSupplementRecord"
        elif method == "DELETE": op = "deleteSupplementRecord"
    elif path == "/api/nutrition/schedules":
        if method == "GET": op = "listSupplementSchedules"
        elif method == "POST": op = "createSupplementSchedule"
        elif method == "DELETE": op = "deleteSupplementSchedule"
    elif path == "/api/growth":
        if method == "GET": op = "listGrowthMeasurements"
        elif method == "POST": op = "createGrowthMeasurement"
        elif method == "DELETE": op = "deleteGrowthMeasurement"
    elif path == "/api/growth/chart": op = "getGrowthChart"
    elif path == "/api/growth/ocr": op = "createGrowthOcrRun"
    elif path == "/api/medical/reports":
        if method == "GET": op = "listMedicalReports"
        elif method == "POST": op = "createMedicalReport"
    elif path.startswith("/api/medical/reports/[id]"):
        if method == "GET": op = "getMedicalReport"
        elif method in ("PUT", "PATCH"): op = "updateMedicalReport"
        elif method == "DELETE": op = "deleteMedicalReport"
    elif path == "/api/medical/upload": op = "uploadAttachment"
    elif path == "/api/medical/ocr": op = "createMedicalOcrRun"
    elif path == "/api/vaccines":
        if method == "GET": op = "getVaccineSchedule"
        elif method == "POST": op = "createVaccineRecord"
    elif path == "/api/vaccines/selections":
        if method == "GET": op = "getVaccineSelections"
        elif method == "PUT": op = "updateVaccineSelections"
    elif path == "/api/ai/chat": op = "sendAiChatMessage"
    elif path == "/api/ai/sessions":
        if method == "GET": op = "listAiSessions"
        elif method == "POST": op = "createAiSession"
    elif path.startswith("/api/ai/sessions/[id]"):
        if method == "GET": op = "getAiSession"
        elif method == "PATCH": op = "updateAiSession"
        elif method == "DELETE": op = "deleteAiSession"
    elif path == "/api/ai/jobs": op = "listAiJobs"
    elif path.startswith("/api/ai/jobs/[id]"):
        if method == "GET": op = "getAiJob"
        elif method == "PATCH": op = "updateAiJob"
    elif path == "/api/ai/daily-summary":
        if method == "GET": op = "listDailySummaries"
        elif method == "POST": op = "createDailySummaryRun"
    elif path == "/api/ai/parse-record": op = "createAiParseRecordRun"
    elif path == "/api/ai/parse-nutrition": op = "createAiParseNutritionRun"
    elif path == "/api/ai/tips": op = "getAiTips"
    elif path == "/api/ai/search": op = "executeAiSearch"
    elif path == "/api/ai/backends": op = "listAiBackends"
    elif path == "/api/agent/voice": op = "createVoiceRun"
    elif path == "/api/agent/voice/logs": op = "listVoiceLogs"
    elif path.startswith("/api/agent/voice/logs/[id]"):
        if method == "GET": op = "getVoiceLog"
        elif method == "PATCH": op = "updateVoiceLog"
    elif path == "/api/asr/transcribe": op = "executeAsrTranscribe"
    elif path == "/api/books": op = "listBooks"
    elif path.startswith("/api/books/[id]"): op = "updateBookStatus"
    elif path == "/api/development/milestones": op = "listMilestones"
    elif path == "/api/development/activities": op = "listActivities"
    elif path == "/api/development/warning-signs": op = "listWarningSigns"
    elif path == "/api/weather": op = "getWeather"
    elif path == "/api/app-config": op = "getAppConfig"
    elif path == "/api/notifications": op = "listNotifications"
    elif path == "/api/push/subscribe": op = "subscribePushNotification"
    elif path == "/api/push/send": op = "sendPushNotification"
    elif path == "/api/push/test": op = "testPushNotification"
    elif path == "/api/push/vapid-key": op = "getPushVapidKey"
    elif path == "/api/user/tokens":
        if method == "GET": op = "listPersonalAccessTokens"
        elif method == "POST": op = "createPersonalAccessToken"
    elif path.startswith("/api/user/tokens/[id]"): op = "deletePersonalAccessToken"
    elif path in ("/api/mcp", "/mcp"):
        if method == "GET": op = "mcpSseConnect"
        elif method == "POST": op = "mcpPostMessage"
        elif method == "DELETE": op = "mcpDisconnect"
        elif method == "OPTIONS": op = "mcpOptions"
    elif path == "/api/oauth/authorize":
        if method == "GET": op = "oauthAuthorizePrompt"
        elif method == "POST": op = "oauthAuthorizeSubmit"
    elif path in ("/api/oauth/token", "/oauth/token"):
        if method == "POST": op = "oauthTokenExchange"
        elif method == "OPTIONS": op = "oauthTokenOptions"
    elif path in ("/api/oauth/revoke", "/oauth/revoke"):
        if method == "POST": op = "oauthTokenRevoke"
        elif method == "OPTIONS": op = "oauthRevokeOptions"
    elif path in ("/api/oauth/register", "/oauth/register"):
        if method == "POST": op = "oauthDynamicClientRegister"
        elif method == "OPTIONS": op = "oauthRegisterOptions"
    elif path == "/.well-known/oauth-authorization-server":
        if method == "GET": op = "oauthAuthorizationServerMetadata"
        elif method == "OPTIONS": op = "oauthMetadataOptions"
    elif path == "/.well-known/oauth-protected-resource":
        if method == "GET": op = "oauthProtectedResourceMetadata"
        elif method == "OPTIONS": op = "oauthProtectedResourceOptions"
    elif path == "/.well-known/oauth-protected-resource/mcp":
        if method == "GET": op = "oauthProtectedMcpResourceMetadata"
        elif method == "OPTIONS": op = "oauthProtectedMcpOptions"
    elif path.startswith("/uploads/"): op = "getUploadedFile"
    else:
        op = f"legacy_{method.lower()}_{path.replace('/', '_').replace('[', '').replace(']', '')}"
    return f"PROPOSED:{op}"

read_actions = ["findUnique", "findFirst", "findMany", "count", "aggregate", "groupBy"]
write_actions = ["create", "update", "delete", "upsert", "deleteMany", "updateMany", "createMany"]

rows = []
for rf in route_files:
    rel_p = rf.relative_to(REPO_ROOT).as_posix()
    api_path = "/" + rf.parent.relative_to(REPO_ROOT / "app").as_posix()
    content = rf.read_text(encoding="utf-8")

    methods = set(re.findall(r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b", content))
    methods.update(re.findall(r"export\s+(?:const|let)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b", content))
    for rm in re.findall(r"export\s*\{\s*([^}]+)\s*\}\s*from", content):
        for item in rm.split(","):
            clean_item = item.strip().split(" as ")[-1].strip()
            if clean_item in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
                methods.add(clean_item)
    methods = sorted(list(methods))

    callers = get_callers(api_path, rel_p)
    tests = get_tests(api_path, rel_p)
    callers_str = "; ".join(callers) if callers else "Unlinked/Direct/External"
    tests_str = "; ".join(tests) if tests else "tests/integration/api (unmapped)"

    for m in methods:
        # Determine precise auth_type
        if api_path in ("/api/mcp", "/mcp"):
            if m == "OPTIONS":
                auth = "CORS Preflight (Public)"
            else:
                auth = "Bearer OAuth Token (Scoped)"
        elif api_path.startswith("/.well-known") or api_path in ("/api/auth/login", "/api/auth/register", "/api/family/preview", "/api/app-config", "/api/push/vapid-key"):
            auth = "CORS Preflight (Public)" if m == "OPTIONS" else "Public / Anonymous"
        elif m == "OPTIONS":
            auth = "CORS Preflight (Public)"
        elif "authenticateRequest" in content or "authenticateBearer" in content:
            auth = "Bearer OAuth Token"
        elif "verifyPersonalAccessToken" in content:
            auth = "PAT or Cookie Session"
        elif "verifyToken" in content:
            auth = "JWT Bearer or Cookie"
        elif "validateTurnstile" in content and m == "POST":
            auth = "Turnstile + Public"
        elif "checkScope" in content:
            auth = "Bearer Scoped OAuth"
        elif api_path.startswith("/uploads/"):
            auth = "Cookie Session (getAuthUser)"
        else:
            auth = "Cookie Session (getAuthUser)"

        # Determine DB reads & writes
        reads = set()
        writes = set()
        for match in re.finditer(r"prisma\.([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)", content):
            model, act = match.groups()
            if act in read_actions:
                reads.add(model)
            elif act in write_actions:
                writes.add(model)

        # Implicit reads/writes from service helpers
        if api_path == "/api/baby" and m == "GET":
            # getActiveBaby helper reads FamilyMember and Baby
            reads.add("baby")
            reads.add("familyMember")
        if "records.create" in content or "records.record" in content or "records.update" in content:
            writes.add("recordSnapshot")
            if "feeding" in api_path: writes.add("feedingRecord")
            elif "sleep" in api_path: writes.add("sleepRecord")
            elif "diaper" in api_path: writes.add("diaperRecord")
        if "records.get" in content or "records.list" in content:
            if "feeding" in api_path: reads.add("feedingRecord")
            elif "sleep" in api_path: reads.add("sleepRecord")
            elif "diaper" in api_path: reads.add("diaperRecord")

        # Refine writes: GET/OPTIONS never writes to DB
        method_writes = writes if m in ("POST", "PUT", "PATCH", "DELETE") else set()
        method_reads = reads

        # Side effects
        side_effects = []
        if m != "OPTIONS":
            if ("openai" in content.lower() or "deepseek" in content.lower() or "gemini" in content.lower() or "chatcompletion" in content.lower()) and m in ("POST", "GET"):
                side_effects.append("LLM/AI Model Request")
            if "sendWebPushNotification" in content or "webpush" in content.lower():
                if m in ("POST", "PUT"):
                    side_effects.append("Web Push Notification")
            if ("writeFile" in content or "upload" in api_path or "avatar" in api_path) and m in ("POST", "PUT"):
                side_effects.append("Local Disk File Write (public/uploads)")
            if "qweather" in content.lower() or "weather" in api_path:
                side_effects.append("External QWeather HTTP Request")
            if ("ReadableStream" in content or "TransformStream" in content or "text/event-stream" in content) and api_path not in ("/api/mcp", "/mcp"):
                side_effects.append("SSE Long-lived Stream")
            if api_path in ("/api/mcp", "/mcp") and m == "GET":
                side_effects.append("SSE Long-lived Stream (MCP Transport)")
            if ("asr" in api_path or "transcribe" in content.lower()) and m == "POST":
                side_effects.append("Local Whisper/ASR CLI Execution")
            if "logOAuthAudit" in content and m in ("POST", "GET"):
                side_effects.append("OAuth Audit Log Entry")

        target_op = map_proposed_operation(m, api_path)
        legacy_status = "ACTIVE_SQLITE"
        growdesk_status = "MISSING_IN_GROWDESK_API"

        db_reads_str = ";".join(sorted(method_reads)) if method_reads else "none"
        db_writes_str = ";".join(sorted(method_writes)) if method_writes else "none"
        side_effects_str = ";".join(side_effects) if side_effects else "none"

        rows.append({
            "method": m,
            "path": api_path,
            "route_file": rel_p,
            "callers": callers_str,
            "auth_type": auth,
            "db_read_models": db_reads_str,
            "db_write_models": db_writes_str,
            "side_effects": side_effects_str,
            "target_operation_id": target_op,
            "legacy_status": legacy_status,
            "growdesk_status": growdesk_status,
            "test_entry": tests_str
        })

fieldnames = [
    "method",
    "path",
    "route_file",
    "callers",
    "auth_type",
    "db_read_models",
    "db_write_models",
    "side_effects",
    "target_operation_id",
    "legacy_status",
    "growdesk_status",
    "test_entry"
]

with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    for r in rows:
        writer.writerow(r)

print(f"Generated {len(rows)} entries in {OUTPUT_CSV}")
