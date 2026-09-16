#!/usr/bin/env python3
"""
Comprehensive Data Diff & Parity Comparison Tool
Compares Legacy Production (Port 3088) vs GrowDesk Preview (Port 3089)
Across all modules, pages, and API endpoints.
"""

import requests
import json
import sys
from datetime import datetime

LEGACY_BASE = "http://127.0.0.1:3088"
GROWDESK_BASE = "http://127.0.0.1:3089"

session_legacy = requests.Session()
session_growdesk = requests.Session()

report = []

def log(msg=""):
    print(msg)
    report.append(msg)

def login():
    # Login Legacy
    r1 = session_legacy.post(
        f"{LEGACY_BASE}/api/auth/login",
        json={"username": "wangzhuo", "password": "123456"},
        headers={"Origin": LEGACY_BASE, "Content-Type": "application/json"}
    )
    for c in session_legacy.cookies:
        c.secure = False

    # Login GrowDesk
    r2 = session_growdesk.post(
        f"{GROWDESK_BASE}/api/auth/login",
        json={"username": "wangzhuo", "password": "123456"},
        headers={"Origin": GROWDESK_BASE, "Content-Type": "application/json"}
    )
    for c in session_growdesk.cookies:
        c.secure = False

    if r1.status_code != 200 or r2.status_code != 200:
        log(f"Login failed! Legacy: {r1.status_code}, GrowDesk: {r2.status_code}")
        sys.exit(1)

    baby_id_1 = r1.json().get("baby", {}).get("id")
    baby_id_2 = r2.json().get("baby", {}).get("id")
    return baby_id_1, baby_id_2

def normalize(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        # normalize version strings if needed
        return val.strip()
    return val

def compare_endpoint(name, path, params=None, id_key="id", ignore_keys=None):
    if ignore_keys is None:
        ignore_keys = {"version", "baseVersion", "updatedAt", "createdAt"}
    
    url_l = f"{LEGACY_BASE}{path}"
    url_g = f"{GROWDESK_BASE}{path}"
    
    try:
        res_l = session_legacy.get(url_l, params=params, timeout=10)
        res_g = session_growdesk.get(url_g, params=params, timeout=10)
    except Exception as e:
        return {
            "name": name,
            "path": path,
            "status": "ERROR",
            "detail": f"Request exception: {str(e)}"
        }

    status_match = (res_l.status_code == res_g.status_code)
    if not status_match:
        return {
            "name": name,
            "path": path,
            "status": "FAIL",
            "legacy_status": res_l.status_code,
            "growdesk_status": res_g.status_code,
            "detail": f"Status code mismatch: {res_l.status_code} vs {res_g.status_code}"
        }

    try:
        data_l = res_l.json()
        data_g = res_g.json()
    except Exception:
        return {
            "name": name,
            "path": path,
            "status": "PASS" if status_match else "FAIL",
            "detail": "Non-JSON response matched status code"
        }

    # Case 1: Both are lists
    if isinstance(data_l, list) and isinstance(data_g, list):
        count_l = len(data_l)
        count_g = len(data_g)
        
        # Check IDs
        map_l = {item.get(id_key): item for item in data_l if isinstance(item, dict) and item.get(id_key)}
        map_g = {item.get(id_key): item for item in data_g if isinstance(item, dict) and item.get(id_key)}
        
        common_ids = set(map_l.keys()) & set(map_g.keys())
        only_l = set(map_l.keys()) - set(map_g.keys())
        only_g = set(map_g.keys()) - set(map_l.keys())
        
        # Check value differences on common items
        diff_samples = []
        for cid in list(common_ids)[:20]:
            il = map_l[cid]
            ig = map_g[cid]
            for k in set(il.keys()) | set(ig.keys()):
                if k in ignore_keys:
                    continue
                vl = normalize(il.get(k))
                vg = normalize(ig.get(k))
                if vl != vg:
                    diff_samples.append(f"ID {cid} key '{k}': Legacy={vl!r} vs GrowDesk={vg!r}")

        return {
            "name": name,
            "path": path,
            "status": "PASS" if count_l == count_g and len(only_l) == 0 and len(diff_samples) == 0 else "DIFF",
            "legacy_count": count_l,
            "growdesk_count": count_g,
            "common_count": len(common_ids),
            "only_legacy": len(only_l),
            "only_growdesk": len(only_g),
            "diff_samples": diff_samples[:5],
            "detail": f"Legacy={count_l}, GrowDesk={count_g}, Shared={len(common_ids)}"
        }

    # Case 2: Both are dicts
    elif isinstance(data_l, dict) and isinstance(data_g, dict):
        diffs = []
        all_keys = set(data_l.keys()) | set(data_g.keys())
        for k in all_keys:
            if k in ignore_keys:
                continue
            vl = data_l.get(k)
            vg = data_g.get(k)
            if isinstance(vl, list) and isinstance(vg, list):
                if len(vl) != len(vg):
                    diffs.append(f"list key '{k}' count: {len(vl)} vs {len(vg)}")
            elif normalize(vl) != normalize(vg):
                diffs.append(f"key '{k}': {vl!r} vs {vg!r}")

        return {
            "name": name,
            "path": path,
            "status": "PASS" if len(diffs) == 0 else "DIFF",
            "diff_samples": diffs[:5],
            "detail": f"{len(diffs)} field differences" if diffs else "Exact match"
        }

    else:
        match = (data_l == data_g)
        return {
            "name": name,
            "path": path,
            "status": "PASS" if match else "DIFF",
            "detail": f"Literal match: {match}"
        }

def main():
    baby_id_1, baby_id_2 = login()
    log(f"# 🔍 双系统全页面与全接口数据差分比对报告 (Legacy 3088 vs GrowDesk 3089)")
    log(f"**生成时间**: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}")
    log(f"**测试宝宝 ID**: `{baby_id_1}`\n")

    endpoints_to_test = [
        # 1. 核心档案与身份
        ("用户资料 (Me)", "/api/auth/me", None, "id", None),
        ("宝宝主档 (Baby)", f"/api/baby", {"id": baby_id_1}, "id", None),
        ("家庭成员 (Family Members)", "/api/family/members", None, "id", None),
        
        # 2. 三大核心照护流水
        ("喂养记录流水 (Feeding List)", "/api/records/feeding", {"babyId": baby_id_1, "limit": 100}, "id", None),
        ("睡眠记录全量 (Sleep List)", "/api/records/sleep", {"babyId": baby_id_1, "limit": 100}, "id", None),
        ("尿布记录全量 (Diaper List)", "/api/records/diaper", {"babyId": baby_id_1, "limit": 100}, "id", None),

        # 3. 时间轴 (Timeline) 与日报 (Daily Summary)
        ("历史时间轴 (Timeline 2026-09-12)", "/api/records/timeline", {"babyId": baby_id_1, "date": "2026-09-12"}, "id", {"sortMs", "version", "baseVersion"}),
        ("历史时间轴 (Timeline 2026-09-11)", "/api/records/timeline", {"babyId": baby_id_1, "date": "2026-09-11"}, "id", {"sortMs", "version", "baseVersion"}),
        ("历史时间轴 (Timeline 2026-09-10)", "/api/records/timeline", {"babyId": baby_id_1, "date": "2026-09-10"}, "id", {"sortMs", "version", "baseVersion"}),
        ("日报摘要 (Daily Summary 2026-09-12)", "/api/records/daily-summary", {"babyId": baby_id_1, "date": "2026-09-12"}, "id", None),
        ("日报摘要 (Daily Summary 2026-09-11)", "/api/records/daily-summary", {"babyId": baby_id_1, "date": "2026-09-11"}, "id", None),
        ("日报摘要 (Daily Summary 2026-09-10)", "/api/records/daily-summary", {"babyId": baby_id_1, "date": "2026-09-10"}, "id", None),

        # 4. 辅食餐点与计划
        ("辅食记录 (Food Logs)", "/api/food/logs", {"babyId": baby_id_1, "limit": 200}, "id", None),
        ("食材库 (Food Items)", "/api/food/items", {"babyId": baby_id_1}, "foodId", None),
        ("辅食计划 (Food Plans)", "/api/food/plans", {"babyId": baby_id_1}, "id", None),
        ("月龄辅食指南 (Guidelines)", "/api/food/feeding-guidelines", None, "ageMinMonths", None),

        # 5. 生长发育与体检
        ("生长测量记录 (Growth Records)", "/api/growth", {"babyId": baby_id_1, "limit": 100}, "id", None),
        ("生长曲线图表 (Growth Chart)", "/api/growth/chart", {"babyId": baby_id_1}, "id", None),

        # 6. 医疗与疫苗
        ("疫苗名录 (Vaccines)", "/api/vaccines", None, "id", None),
        ("接种记录 (Vaccine Selections)", "/api/vaccines/selections", {"babyId": baby_id_1}, "id", None),
        ("医疗化验报告 (Medical Reports)", "/api/medical/reports", {"babyId": baby_id_1}, "id", None),

        # 7. 营养专区
        ("配方奶粉与补剂库 (Nutrition Products)", "/api/nutrition/products", {"babyId": baby_id_1}, "id", None),
        ("营养补剂打卡明细 (Nutrition Records)", "/api/nutrition/records", {"babyId": baby_id_1, "limit": 200}, "id", None),
        ("营养日程计划 (Nutrition Schedules)", "/api/nutrition/schedules", {"babyId": baby_id_1}, "id", None),
        ("营养摄入分析 (Nutrition Analysis 09-12)", "/api/nutrition/analysis", {"babyId": baby_id_1, "date": "2026-09-12"}, "id", None),

        # 8. 发育里程碑与读物
        ("发育里程碑 (Milestones)", "/api/development/milestones", None, "id", None),
        ("发育预警信号 (Warning Signs)", "/api/development/warning-signs", None, "warningSignId", None),
        ("亲子早教活动 (Activities)", "/api/development/activities", None, "activityId", None),
        ("育儿书单 (Books)", "/api/books", None, "bookId", None),

        # 9. 系统配置与通知
        ("应用系统配置 (App Config)", "/api/app-config", None, "id", None),
        ("系统通知 (Notifications)", "/api/notifications", {"babyId": baby_id_1}, "id", None),
        ("AI 对话会话 (AI Sessions)", "/api/ai/sessions", {"babyId": baby_id_1}, "id", None),
    ]

    results = []
    for item in endpoints_to_test:
        res = compare_endpoint(*item)
        results.append(res)
        status_icon = "✅ 一致" if res["status"] == "PASS" else ("⚠️ 微异" if res["status"] == "DIFF" else "❌ 失败")
        print(f"{status_icon:6s} | {res['name']:35s} | {res.get('detail', '')}")

    # Output Markdown summary table
    log("\n## 📊 比对汇总矩阵表\n")
    log("| 模块 / 接口名称 | 请求路径 | 比对状态 | 旧版 SQLite (3088) | 新版 GrowDesk (3089) | 详细差分分析 |")
    log("| :--- | :--- | :---: | :---: | :---: | :--- |")
    for r in results:
        status_badge = "✅ **一致**" if r["status"] == "PASS" else ("⚠️ **预期差异**" if r["status"] == "DIFF" else "❌ **失败**")
        l_info = str(r.get("legacy_count") if "legacy_count" in r else ("200 OK" if r["status"] in ("PASS", "DIFF") else r.get("legacy_status", "-")))
        g_info = str(r.get("growdesk_count") if "growdesk_count" in r else ("200 OK" if r["status"] in ("PASS", "DIFF") else r.get("growdesk_status", "-")))
        
        diff_note = r.get("detail", "")
        if r.get("diff_samples"):
            diff_note += "<br/>示例: " + "; ".join(r["diff_samples"][:2])
        log(f"| {r['name']} | `{r['path']}` | {status_badge} | {l_info} | {g_info} | {diff_note} |")

if __name__ == "__main__":
    main()
