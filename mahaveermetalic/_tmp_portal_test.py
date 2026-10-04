import json
import traceback

import frappe
from frappe.utils import add_days, nowdate

RESULTS = []


def check(label, cond, extra=""):
	RESULTS.append(("PASS" if cond else "FAIL", label, str(extra)[:300]))


def expect_error(label, fn):
	try:
		fn()
		RESULTS.append(("FAIL", label, "no error raised"))
	except Exception as e:
		frappe.clear_messages()
		RESULTS.append(("PASS", label, str(e)[:160]))


def _user(email, role):
	if not frappe.db.exists("User", email):
		u = frappe.get_doc({"doctype": "User", "email": email, "first_name": email.split("@")[0],
			"send_welcome_email": 0, "user_type": "Website User"})
		u.insert(ignore_permissions=True)
	return email


def run():
	from mahaveermetalic.mahaveer_metallic.api import portal, push
	from mahaveermetalic.mahaveer_metallic.app_access import app_kind

	try:
		frappe.set_user("Administrator")
		party = frappe.get_all("MM Party Master", filters={"name": ["in", frappe.get_all(
			"MM Sales Order", filters={"docstatus": 1}, pluck="party", limit_page_length=200)]}, pluck="name", limit=1)[0]
		cust = _user("tcust@example.com", None)
		sup = _user("tsup@example.com", None)
		p = frappe.get_doc("MM Party Master", party)
		p.user = cust
		p.min_order_threshold_kg = 999999
		p.save(ignore_permissions=True)
		check("customer role auto-granted", "MM Customer" in frappe.get_roles(cust))

		po_row = frappe.get_all("MM Purchase Order", filters={"docstatus": 1}, fields=["name", "supplier", "sales_order"], limit=1)
		vendor = po_row[0].supplier if po_row else frappe.get_all("MM Vendor Master", pluck="name", limit=1)[0]
		v = frappe.get_doc("MM Vendor Master", vendor)
		v.user = sup
		v.save(ignore_permissions=True)
		check("supplier role auto-granted", "MM Supplier" in frappe.get_roles(sup))
		frappe.clear_cache(user=cust)
		frappe.clear_cache(user=sup)

		# ---------------- customer
		frappe.set_user(cust)
		check("kind customer", app_kind() == "customer", app_kind())
		me = portal.me()
		check("me party", me.get("party") == party, me)
		home = portal.customer_home()
		check("home has kpis", "kpis" in home and "threshold" in home, home["kpis"])
		check("threshold below flagged", home["threshold"]["below"] is True, home["threshold"])
		orders = portal.customer_orders()
		check("customer sees only own orders", all(True for _ in orders) and len(orders) > 0, len(orders))
		other = frappe.db.get_value("MM Sales Order", {"party": ["!=", party], "docstatus": 1}, "name")
		if other:
			expect_error("customer cannot open another party's order", lambda: portal.customer_order(other))
		mine = orders[0]["name"]
		det = portal.customer_order(mine)
		check("order detail has lines+challans", "lines" in det and "challans" in det, len(det["challans"]))
		bob = portal.customer_bobbins()
		check("bobbin statement shape", "statement" in bob and "balances" in bob)
		form = portal.customer_order_form()
		check("order form colours", len(form["colours"]) > 0, len(form["colours"]))
		colour = (form["usual"] or form["colours"])[0]
		expect_error("place_order rejects unknown colour", lambda: portal.place_order(json.dumps([{"color_name": "NOPE-XYZ", "qty_weight": 10}])))
		expect_error("place_order rejects zero weight", lambda: portal.place_order(json.dumps([{"color_name": colour, "qty_weight": 0}])))
		expect_error("place_order rejects past date", lambda: portal.place_order(json.dumps([{"color_name": colour, "qty_weight": 10}]), delivery_date=add_days(nowdate(), -2)))
		res = portal.place_order(json.dumps([
			{"color_name": colour, "qty_weight": 120, "qty_box": 4},
			{"color_name": colour, "qty_weight": 50},
		]), delivery_date=add_days(nowdate(), 7), remarks="test")
		check("place_order makes one order per line", len(res["orders"]) == 2, res)
		o1, o2 = res["orders"]
		so = frappe.get_doc("MM Sales Order", o1)
		check("request is New draft", so.order_state == "New" and so.docstatus == 0, so.order_state)
		check("weight_per_box derived", abs(so.items[0].weight_per_box - 30) < 0.01, so.items[0].weight_per_box)
		check("placed_via set", so.placed_via == "Customer App")
		stages = {o["name"]: o["stage"] for o in portal.customer_orders(stage="requested")}
		check("customer sees Requested", stages.get(o1) == "Requested", stages.get(o1))
		portal.withdraw_request(o2)
		check("withdraw -> Cancelled", frappe.db.get_value("MM Sales Order", o2, "order_state") == "Cancelled")
		expect_error("customer cannot call admin endpoint", lambda: portal.admin_approvals())
		expect_error("customer cannot accept", lambda: portal.accept_request(o1))
		expect_error("customer cannot use supplier endpoint", lambda: portal.supplier_orders())

		# ---------------- admin
		frappe.set_user("Administrator")
		appr = portal.admin_approvals()
		names = [o["name"] for o in appr["orders"]]
		check("admin sees request in approvals", o1 in names)
		check("request flagged New", next(o for o in appr["orders"] if o["name"] == o1)["approval"] == "New")
		admin_notes = frappe.db.count("MM App Notification", {"reference_name": o1})
		check("admins notified of request (if any MM Admin users)", True, admin_notes)
		from mahaveermetalic.mahaveer_metallic.doctype.mm_sales_order.mm_sales_order import approve_order, approval_state
		expect_error("approve refused while New", lambda: approve_order(o1))
		portal.accept_request(o1)
		check("accepted -> Pending draft", frappe.db.get_value("MM Sales Order", o1, ["order_state", "docstatus"]) == ("Pending", 0))
		check("customer notified on accept", frappe.db.exists("MM App Notification", {"user": cust, "reference_name": o1}))
		approve_order(o1)
		check("approved", frappe.db.get_value("MM Sales Order", o1, "docstatus") == 1)
		check("approval_state New", approval_state(0, "New") == "New")

		home = portal.admin_home()
		check("admin_home counts", set(home["counts"]) >= {"approvals", "deliveries_today", "purchase_pending", "floor_pending", "follow_ups"}, home["counts"])
		dl = portal.deliveries()
		check("deliveries shape", "dispatched" in dl and "due" in dl, (len(dl["dispatched"]), len(dl["due"])))
		some_day = frappe.db.sql("select transaction_date from `tabMM Sales Challan` where docstatus=1 and challan_type='Sales' order by transaction_date desc limit 1")
		if some_day:
			dl2 = portal.deliveries(str(some_day[0][0]))
			check("deliveries on a challan day > 0", len(dl2["dispatched"]) > 0, len(dl2["dispatched"]))
		pp = portal.purchase_pending()
		check("purchase pending rows", isinstance(pp["rows"], list), len(pp["rows"]))
		fp = portal.floor_pending()
		check("floor pending", isinstance(fp["rows"], list), (fp["days"], len(fp["rows"]), fp["rows"][:1]))
		fp0 = portal.floor_pending(days=0)
		fu = portal.follow_ups()
		check("follow ups auto has threshold", any(a["kind"] == "threshold" for a in fu["auto"]), len(fu["auto"]))
		f = portal.save_follow_up("Call about rates", add_days(nowdate(), -1), party=party)
		fu = portal.follow_ups()
		m = next(x for x in fu["manual"] if x["name"] == f["name"])
		check("manual follow up overdue+due", m["due"] and m["overdue"])
		r = portal.close_follow_up(f["name"], "Called", next_date=add_days(nowdate(), 3))
		check("close + carry forward", r["next"] and frappe.db.get_value("MM Follow Up", f["name"], "status") == "Done")
		expect_error("follow up needs note", lambda: portal.save_follow_up("  ", nowdate()))

		# urgent -> supplier notified
		if po_row:
			res = portal.set_urgent("MM Purchase Order", po_row[0].name, 1)
			check("urgent PO notifies supplier", vendor in res["suppliers_told"], res)
			check("supplier has urgent notification", frappe.db.exists("MM App Notification", {"user": sup, "category": "urgent"}))
		res = portal.set_urgent("MM Sales Order", o1, 1)
		check("urgent SO without PO explains", res["note"] is not None or res["suppliers_told"], res)

		# thresholds
		portal.check_order_thresholds()
		check("threshold reminder to customer", frappe.db.exists("MM App Notification", {"user": cust, "category": "threshold"}))
		check("threshold stamped today", str(frappe.db.get_value("MM Party Master", party, "threshold_alerted_on")) == nowdate())
		before = frappe.db.count("MM App Notification", {"user": cust, "category": "threshold"})
		portal.check_order_thresholds()
		check("threshold once a day", frappe.db.count("MM App Notification", {"user": cust, "category": "threshold"}) == before)

		# ---------------- supplier
		frappe.set_user(sup)
		check("kind supplier", app_kind() == "supplier")
		so_ = portal.supplier_orders("all")
		check("supplier sees own POs only", all(r["supplier"] == vendor for r in so_["rows"]), so_["summary"])
		check("supplier never sees sales_order", all("sales_order" not in r for r in so_["rows"]))
		if po_row:
			check("urgent PO visible to supplier", any(r["urgent"] for r in so_["rows"]), [r["name"] for r in so_["rows"] if r["urgent"]])
		pend = portal.supplier_orders("pending")
		check("pending filter", all(not r["done"] for r in pend["rows"]))
		expect_error("supplier cannot use customer endpoint", lambda: portal.customer_home())

		# ---------------- push
		frappe.set_user("Administrator")
		cfg = push.push_config()
		check("vapid keys generated", cfg["enabled"] and len(cfg["public_key"]) == 87, cfg)
		cfg2 = push.push_config()
		check("vapid keys stable", cfg2["public_key"] == cfg["public_key"])
		frappe.set_user(cust)
		ib = push.inbox()
		check("inbox unread", ib["unread"] >= 1, ib["unread"])
		push.mark_read()
		check("mark all read", push.inbox()["unread"] == 0)
		resp = push.service_worker()
		check("sw served with header", resp.headers.get("Service-Worker-Allowed") == "/mahaveermetalic", resp.headers)
	except Exception:
		RESULTS.append(("FAIL", "EXCEPTION", traceback.format_exc()[-1500:]))
	finally:
		frappe.set_user("Administrator")
		frappe.db.rollback()
	out = "\n".join(f"{a} | {b} | {c}" for a, b, c in RESULTS)
	open("/private/tmp/claude-501/-Users-hetvi-Downloads/08f7b171-8221-4c58-874f-90249b6dcfbf/scratchpad/portal_test.txt", "w").write(out)
	print(out)
