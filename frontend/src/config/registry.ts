export type FieldType =
	| "Data"
	| "Small Text"
	| "Select"
	| "Link"
	| "Check"
	| "Currency"
	| "Float"
	| "Int"
	| "Date"
	| "Datetime"
	| "Percent";

export type FieldSchema = {
	fieldname: string;
	label: string;
	fieldtype: FieldType;
	options?: string;
	reqd?: boolean;
	readOnly?: boolean;
	default?: string;
};

export type ChildTableSchema = {
	fieldname: string;
	label: string;
	childDoctype: string;
	columns: FieldSchema[];
	/** Require ≥1 non-empty row after cleanup */
	reqd?: boolean;
};

export type NavGroup = "masters" | "operations" | "tools";

/** Grouped fields on the record form (visual sections, same payload). */
export type FormSectionConfig = {
	id: string;
	title: string;
	description?: string;
	fieldnames: string[];
};

export type DocRegistryEntry = {
	slug: string;
	routeBase: string;
	doctype: string;
	title: string;
	/** Shown under the title on list screens */
	listTagline?: string;
	listColumns: { fieldname: string; label: string }[];
	searchField?: string;
	fields: FieldSchema[];
	childTables?: ChildTableSchema[];
	/** Draft → submitted */
	isSubmittable?: boolean;
	/** Sidebar grouping */
	navGroup?: NavGroup;
	/** When omitted, a single “Details” section is used */
	formSections?: FormSectionConfig[];
};

export function resolveFormSections(meta: DocRegistryEntry): FormSectionConfig[] {
	if (meta.formSections?.length) return meta.formSections;
	return [{ id: "main", title: "Details", fieldnames: meta.fields.map((f) => f.fieldname) }];
}

/** All modules shown in the SPA nav + routes */
export const DOC_REGISTRY: DocRegistryEntry[] = [
	{
		slug: "party",
		routeBase: "/masters/party",
		doctype: "MM Party Master",
		title: "Party Master",
		listTagline: "Customers, billing identities, and how you reach them.",
		navGroup: "masters",
		formSections: [
			{
				id: "identity",
				title: "Identity & reach",
				description: "Legal / trading name and primary contact channels.",
				fieldnames: ["party_name", "mobile_number", "email", "address"],
			},
			{
				id: "poc",
				title: "Point of contact",
				description: "Optional on-site or alternate contact.",
				fieldnames: ["poc_name", "poc_number"],
			},
			{
				id: "refs",
				title: "References",
				description: "Map to legacy or external numbering.",
				fieldnames: ["reference", "reference_number"],
			},
		],
		listColumns: [
			{ fieldname: "party_name", label: "Name" },
			{ fieldname: "mobile_number", label: "Mobile" },
			{ fieldname: "modified", label: "Updated" },
		],
		searchField: "party_name",
		fields: [
			{ fieldname: "party_name", label: "Name", fieldtype: "Data", reqd: true },
			{ fieldname: "mobile_number", label: "Mobile Number", fieldtype: "Data", reqd: true },
			{ fieldname: "email", label: "Email", fieldtype: "Data" },
			{ fieldname: "address", label: "Address", fieldtype: "Small Text" },
			{ fieldname: "poc_name", label: "POC Name", fieldtype: "Data" },
			{ fieldname: "poc_number", label: "POC Number", fieldtype: "Data" },
			{ fieldname: "reference", label: "Reference", fieldtype: "Data" },
			{ fieldname: "reference_number", label: "Reference Number", fieldtype: "Data" },
		],
		childTables: [
			{
				fieldname: "companies",
				label: "Company (multiple)",
				childDoctype: "MM Party Company",
				reqd: true,
				columns: [{ fieldname: "company_name", label: "Company", fieldtype: "Data", reqd: true }],
			},
		],
	},
	{
		slug: "item",
		routeBase: "/masters/item",
		doctype: "MM Item Master",
		title: "Item Master",
		listTagline: "Material types used across SO, inward, and inventory.",
		navGroup: "masters",
		formSections: [
			{
				id: "def",
				title: "Item definition",
				description: "Classification drives reporting and stock views.",
				fieldnames: ["item_type", "item_name", "uom"],
			},
		],
		listColumns: [
			{ fieldname: "item_name", label: "Name" },
			{ fieldname: "item_type", label: "Type" },
			{ fieldname: "uom", label: "UOM" },
		],
		searchField: "item_name",
		fields: [
			{
				fieldname: "item_type",
				label: "Type",
				fieldtype: "Link",
				reqd: true,
				options: "MM Item Type Master",
			},
			{ fieldname: "item_name", label: "Name", fieldtype: "Data", reqd: true },
			{ fieldname: "uom", label: "UOM", fieldtype: "Data" },
		],
	},
	{
		slug: "item-type",
		routeBase: "/masters/item-type",
		doctype: "MM Item Type Master",
		title: "Item Type Master",
		listTagline: "Future-proof item type dictionary.",
		navGroup: "masters",
		formSections: [{ id: "it1", title: "Type", fieldnames: ["type_name"] }],
		listColumns: [
			{ fieldname: "type_name", label: "Type Name" },
		],
		searchField: "type_name",
		fields: [{ fieldname: "type_name", label: "Type Name", fieldtype: "Data", reqd: true }],
	},
	{
		slug: "vendor",
		routeBase: "/masters/vendor",
		doctype: "MM Vendor Master",
		title: "Vendor Master",
		listTagline: "Purchase-side counterparties.",
		navGroup: "masters",
		formSections: [
			{
				id: "v1",
				title: "Vendor profile",
				fieldnames: ["vendor_name", "mobile_no", "email"],
			},
			{ id: "v2", title: "Address", fieldnames: ["address"] },
		],
		listColumns: [
			{ fieldname: "vendor_name", label: "Name" },
			{ fieldname: "mobile_no", label: "Mobile" },
		],
		searchField: "vendor_name",
		fields: [
			{ fieldname: "vendor_name", label: "Name", fieldtype: "Data", reqd: true },
			{ fieldname: "mobile_no", label: "Mobile No", fieldtype: "Data", reqd: true },
			{ fieldname: "email", label: "Email", fieldtype: "Data" },
			{ fieldname: "address", label: "Address", fieldtype: "Small Text" },
		],
	},
	{
		slug: "bobbin",
		routeBase: "/masters/bobbin",
		doctype: "MM Bobbin Master",
		title: "Bobbin Master",
		listTagline: "Bobbin types used on challans and tracking.",
		navGroup: "masters",
		formSections: [{ id: "b1", title: "Bobbin specification", fieldnames: ["bobbin_name", "quality", "weight"] }],
		listColumns: [
			{ fieldname: "bobbin_name", label: "Name" },
			{ fieldname: "quality", label: "Quality" },
		],
		searchField: "bobbin_name",
		fields: [
			{ fieldname: "bobbin_name", label: "Name", fieldtype: "Data", reqd: true },
			{ fieldname: "quality", label: "Quality", fieldtype: "Data" },
			{ fieldname: "weight", label: "Weight", fieldtype: "Float" },
		],
	},
	{
		slug: "employee",
		routeBase: "/masters/employee",
		doctype: "MM Employee Master",
		title: "Employee Master",
		listTagline: "People mapped to locations and departments.",
		navGroup: "masters",
		formSections: [
			{ id: "e1", title: "Person", fieldnames: ["employee_name", "mobile_number"] },
			{ id: "e2", title: "Placement", description: "Where they work in the network.", fieldnames: ["location", "department"] },
		],
		listColumns: [
			{ fieldname: "employee_name", label: "Name" },
			{ fieldname: "location", label: "Location" },
			{ fieldname: "department", label: "Department" },
		],
		searchField: "employee_name",
		fields: [
			{ fieldname: "employee_name", label: "Name", fieldtype: "Data", reqd: true },
			{ fieldname: "mobile_number", label: "Mobile Number", fieldtype: "Data" },
			{ fieldname: "location", label: "Location", fieldtype: "Link", options: "MM Location Master" },
			{ fieldname: "department", label: "Department", fieldtype: "Data" },
		],
	},
	{
		slug: "location",
		routeBase: "/masters/location",
		doctype: "MM Location Master",
		title: "Location Master",
		listTagline: "Sites used for stock and inward.",
		navGroup: "masters",
		formSections: [
			{ id: "l1", title: "Site", fieldnames: ["location_name", "contact_number"] },
			{ id: "l2", title: "Address", fieldnames: ["address"] },
		],
		listColumns: [
			{ fieldname: "location_name", label: "Name" },
			{ fieldname: "contact_number", label: "Contact" },
		],
		searchField: "location_name",
		fields: [
			{ fieldname: "location_name", label: "Name", fieldtype: "Data", reqd: true },
			{ fieldname: "address", label: "Address", fieldtype: "Small Text", reqd: true },
			{ fieldname: "contact_number", label: "Contact Number", fieldtype: "Data" },
		],
	},
	{
		slug: "roll",
		routeBase: "/roll-inventory",
		doctype: "MM Roll Inventory",
		title: "Roll inventory",
		listTagline: "Balances by location, color, cut, and lot.",
		navGroup: "operations",
		formSections: [
			{
				id: "r1",
				title: "Identification",
				description: "Roll / lot identity and where stock sits.",
				fieldnames: ["roll_no", "lot_number", "branch", "location", "supplier", "item_type"],
			},
			{
				id: "r2",
				title: "Variant",
				description: "What the roll represents on the floor.",
				fieldnames: ["color_name", "cut"],
			},
			{ id: "r3", title: "Stock states", fieldnames: ["stock_weight", "stock_box", "reserved_weight", "issued_weight", "available_weight", "reorder_weight"] },
		],
		listColumns: [
			{ fieldname: "location", label: "Location" },
			{ fieldname: "color_name", label: "Color" },
			{ fieldname: "stock_weight", label: "Wt" },
		],
		searchField: "color_name",
		fields: [
			{ fieldname: "roll_no", label: "Roll No", fieldtype: "Data" },
			{ fieldname: "lot_number", label: "Lot Number", fieldtype: "Data" },
			{ fieldname: "branch", label: "Branch", fieldtype: "Link", options: "Branch" },
			{ fieldname: "location", label: "Location", fieldtype: "Link", options: "MM Location Master", reqd: true },
			{ fieldname: "supplier", label: "Supplier", fieldtype: "Link", options: "MM Vendor Master" },
			{ fieldname: "color_name", label: "Color", fieldtype: "Data", reqd: true },
			{ fieldname: "cut", label: "Cut", fieldtype: "Data" },
			{ fieldname: "item_type", label: "Item Type", fieldtype: "Link", options: "MM Item Master" },
			{ fieldname: "stock_weight", label: "Stock (Weight)", fieldtype: "Float" },
			{ fieldname: "stock_box", label: "Stock (Box)", fieldtype: "Float" },
			{ fieldname: "reserved_weight", label: "Reserved (Weight)", fieldtype: "Float" },
			{ fieldname: "issued_weight", label: "Issued (Weight)", fieldtype: "Float" },
			{ fieldname: "available_weight", label: "Available (Weight)", fieldtype: "Float", readOnly: true },
			{ fieldname: "reorder_weight", label: "Reorder Level (Weight)", fieldtype: "Float" },
		],
	},
	{
		slug: "sales-order",
		routeBase: "/sales-order",
		doctype: "MM Sales Order",
		title: "Sales Orders",
		listTagline: "Commercial header, planning, and line-wise pricing.",
		navGroup: "operations",
		formSections: [
			{
				id: "so-h",
				title: "Order header",
				description: "Series, dates, and sold-to party.",
				fieldnames: ["naming_series", "transaction_date", "delivery_date", "branch", "party"],
			},
			{
				id: "so-x",
				title: "Production & control",
				description: "Weights, production % and lock are system-driven.",
				fieldnames: [
					"ordered_weight",
					"inwarded_weight",
					"required_weight",
					"production_completed_percent",
					"order_locked",
				],
			},
		],
		listColumns: [
			{ fieldname: "name", label: "SO No" },
			{ fieldname: "transaction_date", label: "Date" },
			{ fieldname: "delivery_date", label: "Delivery" },
			{ fieldname: "party", label: "Party" },
			{ fieldname: "ordered_weight", label: "Weight" },
			{ fieldname: "inwarded_weight", label: "Inwards" },
			{ fieldname: "required_weight", label: "Required" },
			{ fieldname: "order_locked", label: "Locked" },
		],
		searchField: "party",
		fields: [
			{
				fieldname: "naming_series",
				label: "Series",
				fieldtype: "Select",
				reqd: true,
				options: "MM-SO-.YYYY.-",
				default: "MM-SO-.YYYY.-",
			},
			{ fieldname: "transaction_date", label: "Date", fieldtype: "Date", reqd: true },
			{ fieldname: "delivery_date", label: "Delivery Date", fieldtype: "Date" },
			{ fieldname: "branch", label: "Branch", fieldtype: "Link", options: "Branch" },
			{ fieldname: "party", label: "Party", fieldtype: "Link", options: "MM Party Master", reqd: true },
			{ fieldname: "ordered_weight", label: "Order Weight (Kg)", fieldtype: "Float", readOnly: true },
			{ fieldname: "inwarded_weight", label: "Inwards (Kg)", fieldtype: "Float", readOnly: true },
			{ fieldname: "required_weight", label: "Required (Kg)", fieldtype: "Float", readOnly: true },
			{
				fieldname: "production_completed_percent",
				label: "Production %",
				fieldtype: "Percent",
				readOnly: true,
			},
			{ fieldname: "order_locked", label: "Locked", fieldtype: "Check", readOnly: true },
		],
		childTables: [
			{
				fieldname: "items",
				label: "Line items",
				childDoctype: "MM Sales Order Item",
				reqd: true,
				columns: [
					{ fieldname: "color_name", label: "Color", fieldtype: "Data", reqd: true },
					{ fieldname: "qty_weight", label: "Qty (weight)", fieldtype: "Float", reqd: true },
					{ fieldname: "qty_box", label: "Qty (box)", fieldtype: "Float" },
					{ fieldname: "cut", label: "Cut", fieldtype: "Data" },
					{ fieldname: "sale_rate", label: "Sale rate", fieldtype: "Currency", reqd: true },
					{ fieldname: "purchase_party", label: "Purchase party", fieldtype: "Link", options: "MM Party Master" },
					{ fieldname: "purchase_rate", label: "Purchase rate", fieldtype: "Currency" },
				],
			},
		],
	},
	{
		slug: "purchase-order",
		routeBase: "/purchase-order",
		doctype: "MM Purchase Order",
		title: "Purchase Orders",
		listTagline: "Buy-side cover when roll stock is short.",
		navGroup: "operations",
		formSections: [
			{
				id: "po1",
				title: "Linkage",
				description: "Ties back to a sales order; PO number follows SO.",
				fieldnames: ["transaction_date", "branch", "sales_order", "po_number"],
			},
			{ id: "po2", title: "Material", fieldnames: ["color", "qty_kg", "rate"] },
			{ id: "po3", title: "Logistics", fieldnames: ["delivery_date"] },
		],
		listColumns: [
			{ fieldname: "po_number", label: "PO No" },
			{ fieldname: "color", label: "Color" },
			{ fieldname: "qty_kg", label: "Qty KG" },
		],
		searchField: "color",
		fields: [
			{ fieldname: "transaction_date", label: "Date", fieldtype: "Date", reqd: true },
			{ fieldname: "branch", label: "Branch", fieldtype: "Link", options: "Branch" },
			{ fieldname: "sales_order", label: "SO reference", fieldtype: "Link", options: "MM Sales Order" },
			{ fieldname: "po_number", label: "PO number (= SO)", fieldtype: "Data", readOnly: true },
			{ fieldname: "color", label: "Color", fieldtype: "Data", reqd: true },
			{ fieldname: "qty_kg", label: "Qty (KG)", fieldtype: "Float", reqd: true },
			{ fieldname: "rate", label: "Rate", fieldtype: "Currency", reqd: true },
			{ fieldname: "delivery_date", label: "Delivery date", fieldtype: "Date" },
		],
	},
	{
		slug: "bobbin-tracking",
		routeBase: "/bobbin-tracking",
		doctype: "MM Bobbin Box Tracking",
		title: "Bobbin / Box tracking",
		listTagline: "Challan-based movement of bobbins and boxes.",
		navGroup: "operations",
		formSections: [
			{
				id: "bb1",
				title: "Challan",
				description: "Direction of movement and counterparty.",
				fieldnames: ["challan_number", "chalan_date", "given_received", "party", "note", "returnable_box"],
			},
		],
		listColumns: [
			{ fieldname: "challan_number", label: "Challan" },
			{ fieldname: "chalan_date", label: "Date" },
			{ fieldname: "given_received", label: "Given/Recv" },
			{ fieldname: "party", label: "Party" },
		],
		searchField: "challan_number",
		fields: [
			{ fieldname: "challan_number", label: "Challan number", fieldtype: "Data", reqd: true },
			{ fieldname: "chalan_date", label: "Chalan Date", fieldtype: "Date", reqd: true },
			{
				fieldname: "given_received",
				label: "Given / Received",
				fieldtype: "Select",
				reqd: true,
				options: "Given\nReceived",
				default: "Given",
			},
			{ fieldname: "party", label: "Party", fieldtype: "Link", options: "MM Party Master", reqd: true },
			{ fieldname: "note", label: "Note", fieldtype: "Small Text" },
			{ fieldname: "returnable_box", label: "Returnable box", fieldtype: "Check" },
		],
		childTables: [
			{
				fieldname: "lines",
				label: "Bobbin / box lines",
				childDoctype: "MM Bobbin Box Line",
				reqd: true,
				columns: [
					{ fieldname: "bobbin_type", label: "Bobbin type", fieldtype: "Link", options: "MM Bobbin Master" },
					{ fieldname: "bobbin_qty", label: "Bobbin qty", fieldtype: "Float" },
					{ fieldname: "box_qty", label: "Box qty", fieldtype: "Float" },
				],
			},
		],
	},
	{
		slug: "inward",
		routeBase: "/inward",
		doctype: "MM Inward",
		title: "Inward",
		listTagline: "Receipts that increase roll stock (submit to post).",
		navGroup: "operations",
		isSubmittable: true,
		formSections: [
			{
				id: "in1",
				title: "Where & when",
				fieldnames: ["branch", "location", "posting_date"],
			},
			{
				id: "in2",
				title: "References",
				description: "Optional SO / party / challan traceability.",
				fieldnames: ["sales_order", "party", "challan_number", "veermetlon_delivery_challan", "veermetlon_job_card"],
			},
			{ id: "in3", title: "Material", fieldnames: ["item_type", "rate", "lot_number"] },
		],
		listColumns: [
			{ fieldname: "posting_date", label: "Date" },
			{ fieldname: "location", label: "Location" },
			{ fieldname: "docstatus", label: "Status" },
		],
		searchField: "lot_number",
		fields: [
			{ fieldname: "branch", label: "Branch", fieldtype: "Link", options: "Branch" },
			{ fieldname: "location", label: "Location", fieldtype: "Link", options: "MM Location Master", reqd: true },
			{ fieldname: "posting_date", label: "Date", fieldtype: "Date", reqd: true },
			{ fieldname: "sales_order", label: "SO number", fieldtype: "Link", options: "MM Sales Order" },
			{ fieldname: "party", label: "Party", fieldtype: "Link", options: "MM Party Master" },
			{ fieldname: "challan_number", label: "Challan number", fieldtype: "Data" },
			{ fieldname: "veermetlon_delivery_challan", label: "Veermetlon challan", fieldtype: "Link", options: "Delivery Challan" },
			{ fieldname: "veermetlon_job_card", label: "Veermetlon job card", fieldtype: "Link", options: "Job Card" },
			{ fieldname: "item_type", label: "Item type", fieldtype: "Link", options: "MM Item Master", reqd: true },
			{ fieldname: "rate", label: "Rate", fieldtype: "Currency" },
			{ fieldname: "lot_number", label: "Lot number", fieldtype: "Data", reqd: true },
		],
		childTables: [
			{
				fieldname: "items",
				label: "Inward items (rolls received)",
				childDoctype: "MM Inward Item",
				reqd: true,
				columns: [
					{ fieldname: "job_work", label: "Job Work", fieldtype: "Check" },
					{ fieldname: "challan_number", label: "Challan No", fieldtype: "Data" },
					{ fieldname: "customer_order", label: "Customer Order", fieldtype: "Link", options: "MM Sales Order" },
					{ fieldname: "roll_name", label: "Roll", fieldtype: "Data" },
					{ fieldname: "color_name", label: "Color", fieldtype: "Data", reqd: true },
					{ fieldname: "cut", label: "Cut", fieldtype: "Data" },
					{ fieldname: "qty_box", label: "Qty (Box)", fieldtype: "Float" },
					{ fieldname: "weight", label: "Weight (Kg)", fieldtype: "Float", reqd: true },
				],
			},
		],
	},
	{
		slug: "cutting",
		routeBase: "/cutting",
		doctype: "MM Cutting",
		title: "Cutting",
		listTagline: "Floor production that feeds SO completion %.",
		navGroup: "operations",
		isSubmittable: true,
		formSections: [
			{
				id: "cu1",
				title: "Roll & shade",
				description: "Pick the source roll in stock; net weight cut is deducted from it on submit.",
				fieldnames: ["posting_date", "customer_order", "source_roll", "roll_no", "branch", "shade", "cut", "status", "job_work_flag"],
			},
			{
				id: "cu2",
				title: "Totals",
				description: "Auto-calculated from the patti rows.",
				fieldnames: ["total_patti_qty", "total_net_weight"],
			},
		],
		listColumns: [
			{ fieldname: "roll_no", label: "Roll" },
			{ fieldname: "status", label: "Status" },
			{ fieldname: "total_net_weight", label: "Net Wt" },
			{ fieldname: "docstatus", label: "Doc" },
		],
		searchField: "roll_no",
		fields: [
			{ fieldname: "posting_date", label: "Date", fieldtype: "Date", reqd: true },
			{ fieldname: "customer_order", label: "Customer Order", fieldtype: "Link", options: "MM Sales Order" },
			{ fieldname: "source_roll", label: "Source Roll (stock)", fieldtype: "Link", options: "MM Roll Inventory" },
			{ fieldname: "roll_no", label: "Roll no", fieldtype: "Data", reqd: true },
			{ fieldname: "branch", label: "Branch", fieldtype: "Link", options: "Branch" },
			{ fieldname: "shade", label: "Shade", fieldtype: "Data" },
			{ fieldname: "cut", label: "Cut", fieldtype: "Data" },
			{
				fieldname: "status",
				label: "Status",
				fieldtype: "Select",
				reqd: true,
				options: "Draft\nIn Progress\nCompleted",
				default: "Draft",
			},
			{ fieldname: "job_work_flag", label: "Job work", fieldtype: "Check" },
			{ fieldname: "total_patti_qty", label: "Total Patti Qty", fieldtype: "Float", readOnly: true },
			{ fieldname: "total_net_weight", label: "Total Net Weight (Kg)", fieldtype: "Float", readOnly: true },
		],
		childTables: [
			{
				fieldname: "patti_entries",
				label: "Patti entries",
				childDoctype: "MM Cutting Patti",
				reqd: true,
				columns: [
					{ fieldname: "shade", label: "Shade", fieldtype: "Data" },
					{ fieldname: "cut", label: "Cut", fieldtype: "Data" },
					{ fieldname: "patti_qty", label: "Patti Qty", fieldtype: "Float", reqd: true },
					{ fieldname: "net_weight", label: "Net Weight (Kg)", fieldtype: "Float", reqd: true },
					{ fieldname: "weight_per_patti", label: "Wt / Patti", fieldtype: "Float", readOnly: true },
				],
			},
		],
	},
	{
		slug: "task-reminder",
		routeBase: "/tools/task-reminder",
		doctype: "MM Task Reminder",
		title: "Task reminders",
		listTagline: "Raven-backed recurring nudges with optional Yes/No poll to mark complete.",
		navGroup: "tools",
		formSections: [
			{
				id: "tr1",
				title: "Task & schedule",
				description: "When reminders start, optional end window, and repeat interval (hours).",
				fieldnames: ["title", "status", "from_datetime", "to_datetime", "reminder_interval_hours"],
			},
			{
				id: "tr2",
				title: "Notes",
				fieldnames: ["description"],
			},
			{
				id: "tr3",
				title: "Raven",
				description: "Configure the bot in MM Raven Task Notification Settings (Desk).",
				fieldnames: ["include_yes_no_poll"],
			},
			{
				id: "tr4",
				title: "System",
				description: "Updated by the scheduler and when the task is completed.",
				fieldnames: ["last_reminder_sent", "completed_on", "completed_by"],
			},
		],
		listColumns: [
			{ fieldname: "title", label: "Task" },
			{ fieldname: "status", label: "Status" },
			{ fieldname: "from_datetime", label: "From" },
			{ fieldname: "modified", label: "Updated" },
		],
		searchField: "title",
		fields: [
			{ fieldname: "title", label: "Task title", fieldtype: "Data", reqd: true },
			{
				fieldname: "status",
				label: "Status",
				fieldtype: "Select",
				reqd: true,
				options: "Draft\nActive\nCompleted\nCancelled",
				default: "Draft",
			},
			{ fieldname: "from_datetime", label: "Remind from", fieldtype: "Datetime", reqd: true },
			{ fieldname: "to_datetime", label: "Remind until", fieldtype: "Datetime" },
			{ fieldname: "reminder_interval_hours", label: "Interval (hours)", fieldtype: "Float", reqd: true, default: "1" },
			{ fieldname: "description", label: "Details", fieldtype: "Small Text" },
			{ fieldname: "include_yes_no_poll", label: "Include Yes/No (Raven poll)", fieldtype: "Check", default: "1" },
			{ fieldname: "last_reminder_sent", label: "Last reminder sent", fieldtype: "Datetime", readOnly: true },
			{ fieldname: "completed_on", label: "Completed on", fieldtype: "Datetime", readOnly: true },
			{ fieldname: "completed_by", label: "Completed by", fieldtype: "Link", options: "User", readOnly: true },
		],
		childTables: [
			{
				fieldname: "reminder_recipients",
				label: "Users — recurring reminders",
				childDoctype: "MM Task Reminder Recipient",
				reqd: true,
				columns: [
					{ fieldname: "user", label: "User", fieldtype: "Link", options: "User", reqd: true },
					{ fieldname: "completed_at_reminder", label: "Completed at Reminder Count", fieldtype: "Int", readOnly: true },
					{ fieldname: "completed_time", label: "Completed Time", fieldtype: "Datetime", readOnly: true },
					{ fieldname: "remark", label: "Remark", fieldtype: "Small Text", readOnly: true },
				],
			},
			{
				fieldname: "completion_recipients",
				label: "Users — notify when completed",
				childDoctype: "MM Task Reminder Completion Recipient",
				columns: [{ fieldname: "user", label: "User", fieldtype: "Link", options: "User", reqd: true }],
			},
		],
	},
];

export function getRegistry(slug: string): DocRegistryEntry | undefined {
	return DOC_REGISTRY.find((d) => d.slug === slug);
}

export function getRegistryByPath(pathname: string): DocRegistryEntry | undefined {
	return DOC_REGISTRY.find(
		(d) => pathname === d.routeBase || pathname.startsWith(`${d.routeBase}/`),
	);
}
