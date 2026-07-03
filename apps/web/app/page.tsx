"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import styles from "./page.module.css";

type Area = "drugstore" | "bar";

type Product = {
  id: string;
  name: string;
  barcodes: string[];
  category: string;
  area: Area;
  price: number;
  stock: number;
  min: number;
};

type LineItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
};

type Sale = {
  id: string;
  ticketNumber: string;
  createdAt: string;
  area: Area;
  customer: string;
  payment: string;
  items: LineItem[];
  total: number;
  cashSessionId: string;
};

type CashMovement = {
  id: string;
  type: "ingreso" | "gasto" | "retiro";
  amount: number;
  reason: string;
  createdAt: string;
};

type CashSession = {
  id: string;
  area: Area;
  status: "abierta" | "cerrada";
  openedAt: string;
  openedBy: string;
  openingAmount: number;
  movements: CashMovement[];
  closedAt?: string;
  closedBy?: string;
  countedAmount?: number;
  expectedAmount?: number;
  difference?: number;
};

type TableStatus = "vacio" | "preparacion" | "entregado";

type TableOrder = {
  id: string;
  name: string;
  status: TableStatus;
  items: LineItem[];
};

type AppState = {
  settings: {
    businessName: string;
    businessAddress: string;
    businessPhone: string;
    ticketFooter: string;
  };
  products: Product[];
  sales: Sale[];
  tables: TableOrder[];
  cashSessions: CashSession[];
};

type View = "dashboard" | "drugstore" | "bar" | "reports" | "settings";
type DrugstoreOption = "venta" | "stock";
type BarOption = "mesas" | "menu" | "venta";

const seedState: AppState = {
  settings: {
    businessName: "Al toque",
    businessAddress: "",
    businessPhone: "",
    ticketFooter: "Gracias por su compra",
  },
  products: [],
  sales: [],
  tables: [],
  cashSessions: [],
};

const viewCopy: Record<View, [string, string]> = {
  dashboard: ["Resumen", "Ventas, stock y mesas en un solo lugar."],
  drugstore: ["Drugstore", "Ventas, tickets y stock del drugstore."],
  bar: ["Bar", "Menu, mesas, estados de pedido y ventas del bar."],
  reports: ["Reportes", "Control de que se vende y por donde entra la plata."],
  settings: ["Ajustes", "Datos que aparecen en los tickets."],
};

const blankProduct: Product = {
  id: "",
  name: "",
  barcodes: [],
  category: "",
  area: "drugstore",
  price: 0,
  stock: 0,
  min: 0,
};

export default function Home() {
  const [state, setState] = useState<AppState>(seedState);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [drugstoreOption, setDrugstoreOption] = useState<DrugstoreOption>("venta");
  const [barOption, setBarOption] = useState<BarOption>("mesas");
  const [drugstoreCart, setDrugstoreCart] = useState<LineItem[]>([]);
  const [barCart, setBarCart] = useState<LineItem[]>([]);
  const [saleSearch, setSaleSearch] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeMessage, setBarcodeMessage] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const barcodeValueRef = useRef("");
  const barcodeDetectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProcessedBarcodeRef = useRef({ code: "", time: 0 });
  const [barSearch, setBarSearch] = useState("");
  const [drugstoreCustomer, setDrugstoreCustomer] = useState("");
  const [barCustomer, setBarCustomer] = useState("");
  const [drugstorePayment, setDrugstorePayment] = useState("Efectivo");
  const [barPayment, setBarPayment] = useState("Efectivo");
  const [tablePayment, setTablePayment] = useState("Efectivo");
  const [reportDate, setReportDate] = useState(() => dateKey(new Date()));
  const [selectedTableId, setSelectedTableId] = useState(seedState.tables[0]?.id ?? "");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);
  const [closingCash, setClosingCash] = useState<CashSession | null>(null);
  const [movementCash, setMovementCash] = useState<CashSession | null>(null);
  const [managementMode, setManagementMode] = useState<Area | null>(null);
  const saleInProgressRef = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      setDataLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setDataLoading(false);
      return;
    }
    let active = true;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const remoteState = await loadRemoteState();
        if (!active) return;
        setState(remoteState);
        setSelectedTableId((current) => remoteState.tables.some((table) => table.id === current) ? current : (remoteState.tables[0]?.id ?? ""));
        setSyncError("");
      } catch {
        if (active) setSyncError("No se pudo conectar con Supabase.");
      } finally {
        if (active) setDataLoading(false);
      }
    };
    const scheduleRefresh = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void refresh(), 120);
    };
    void refresh();
    const channel = supabase.channel("al-toque-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "bar_tables" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_sessions" }, scheduleRefresh)
      .subscribe();
    return () => {
      active = false;
      if (reloadTimer) clearTimeout(reloadTimer);
      void supabase.removeChannel(channel);
    };
  }, [session]);

  useEffect(() => {
    if (view !== "drugstore" || drugstoreOption !== "venta") return;
    window.requestAnimationFrame(() => barcodeInputRef.current?.focus());
  }, [view, drugstoreOption, drugstoreCart]);

  useEffect(() => () => {
    if (barcodeDetectionTimerRef.current) clearTimeout(barcodeDetectionTimerRef.current);
  }, []);

  const todaySales = useMemo(() => state.sales.filter((sale) => isToday(sale.createdAt)), [state.sales]);
  const drugstoreSales = state.sales.filter((sale) => sale.area === "drugstore");
  const barSales = state.sales.filter((sale) => sale.area === "bar");
  const openDrugstoreCash = state.cashSessions.find((cash) => cash.area === "drugstore" && cash.status === "abierta");
  const openBarCash = state.cashSessions.find((cash) => cash.area === "bar" && cash.status === "abierta");
  const currentDrugstoreSales = openDrugstoreCash ? drugstoreSales.filter((sale) => sale.cashSessionId === openDrugstoreCash.id) : [];
  const currentBarSales = openBarCash ? barSales.filter((sale) => sale.cashSessionId === openBarCash.id) : [];
  const selectedDaySales = state.sales.filter((sale) => dateKey(new Date(sale.createdAt)) === reportDate);
  const selectedDayDrugstoreSales = selectedDaySales.filter((sale) => sale.area === "drugstore");
  const selectedDayBarSales = selectedDaySales.filter((sale) => sale.area === "bar");
  const todayDrugstoreSales = todaySales.filter((sale) => sale.area === "drugstore");
  const openTables = state.tables.filter((table) => table.items.length);
  const lowDrugstoreStock = state.products.filter((product) => product.area === "drugstore" && product.stock <= product.min);
  const selectedTable = state.tables.find((table) => table.id === selectedTableId);
  const filteredDrugstoreSaleProducts = filterProducts(state.products, "drugstore", saleSearch);
  const filteredBarSaleProducts = filterProducts(state.products, "bar", saleSearch);
  const filteredMenu = filterProducts(state.products, "bar", barSearch);
  const drugstoreProducts = state.products.filter((product) => product.area === "drugstore");
  const barProducts = state.products.filter((product) => product.area === "bar");
  const drugstoreCartSum = total(drugstoreCart);
  const barCartSum = total(barCart);
  const tableSum = total(selectedTable?.items ?? []);
  const [title, subtitle] = viewCopy[view];

  function mutate(next: AppState) {
    const previous = state;
    setState(next);
    setSyncError("");
    void persistStateChanges(previous, next).catch(() => setSyncError("No se pudieron guardar los cambios."));
  }

  function addLine(productId: string, target: "drugstoreCart" | "barCart" | "table") {
    const product = state.products.find((entry) => entry.id === productId);
    if (!product) return;

    const apply = (items: LineItem[]) => {
      const current = items.find((item) => item.productId === productId);
      if (current) {
        return items.map((item) => item.productId === productId ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...items, { productId, name: product.name, price: product.price, qty: 1 }];
    };

    if (target === "drugstoreCart") {
      setDrugstoreCart(apply);
      return;
    }

    if (target === "barCart") {
      setBarCart(apply);
      return;
    }

    mutate({
      ...state,
      tables: state.tables.map((table) => table.id === selectedTableId ? { ...table, status: "preparacion", items: apply(table.items) } : table),
    });
  }

  function changeQty(productId: string, delta: number, target: "drugstoreCart" | "barCart" | "table") {
    const apply = (items: LineItem[]) => {
      return items
        .map((item) => {
          if (item.productId !== productId) return item;
          const nextQty = Math.max(0, item.qty + delta);
          return { ...item, qty: nextQty };
        })
        .filter((item) => item.qty > 0);
    };

    if (target === "drugstoreCart") {
      setDrugstoreCart(apply);
      return;
    }

    if (target === "barCart") {
      setBarCart(apply);
      return;
    }

    mutate({
      ...state,
      tables: state.tables.map((table) => {
        if (table.id !== selectedTableId) return table;
        const items = apply(table.items);
        return { ...table, status: items.length ? table.status : "vacio", items };
      }),
    });
  }

  function createSale(area: Area, saleCustomer: string, salePayment: string, items: LineItem[]) {
    const cashSession = area === "drugstore" ? openDrugstoreCash : openBarCash;
    if (!cashSession) {
      window.alert("Primero tenes que abrir la caja.");
      return null;
    }
    const sale: Sale = {
      id: crypto.randomUUID(),
      ticketNumber: nextTicketNumber(state.sales, area),
      createdAt: new Date().toISOString(),
      area,
      customer: saleCustomer || "Consumidor final",
      payment: salePayment,
      items,
      total: total(items),
      cashSessionId: cashSession.id,
    };
    mutate({
      ...state,
      products: state.products.map((product) => {
        const item = items.find((entry) => entry.productId === product.id);
        return item && product.area === "drugstore" ? { ...product, stock: product.stock - item.qty } : product;
      }),
      sales: [...state.sales, sale],
    });
    return sale;
  }

  function finishSale(area: Area) {
    const cart = area === "drugstore" ? drugstoreCart : barCart;
    if (!cart.length || saleInProgressRef.current) return;
    saleInProgressRef.current = true;
    const sale = createSale(
      area,
      area === "drugstore" ? drugstoreCustomer : barCustomer,
      area === "drugstore" ? drugstorePayment : barPayment,
      cart,
    );
    if (!sale) {
      saleInProgressRef.current = false;
      return;
    }
    if (area === "drugstore") {
      setDrugstoreCart([]);
      setDrugstoreCustomer("");
    } else {
      setBarCart([]);
      setBarCustomer("");
    }
    setTimeout(() => printTicket(state.settings, sale), 50);
    setTimeout(() => { saleInProgressRef.current = false; }, 1200);
  }

  function closeTable() {
    if (!selectedTable?.items.length || saleInProgressRef.current) return;
    if (!openBarCash) {
      window.alert("Primero tenes que abrir la caja del Bar.");
      return;
    }
    saleInProgressRef.current = true;
    const sale: Sale = {
      id: crypto.randomUUID(),
      ticketNumber: nextTicketNumber(state.sales, "bar"),
      createdAt: new Date().toISOString(),
      area: "bar",
      customer: selectedTable.name,
      payment: tablePayment,
      items: selectedTable.items,
      total: tableSum,
      cashSessionId: openBarCash.id,
    };
    mutate({
      ...state,
      products: state.products,
      sales: [...state.sales, sale],
      tables: state.tables.map((table) => table.id === selectedTable.id ? { ...table, status: "vacio", items: [] } : table),
    });
    setTablePayment("Efectivo");
    setTimeout(() => printTicket(state.settings, sale), 50);
    setTimeout(() => { saleInProgressRef.current = false; }, 1200);
  }

  async function openCash(area: Area, openingAmount: number) {
    const cashSession: CashSession = {
      id: crypto.randomUUID(),
      area,
      status: "abierta",
      openedAt: new Date().toISOString(),
      openedBy: session?.user.email ?? "Usuario",
      openingAmount,
      movements: [],
    };
    const { error } = await supabase.from("cash_sessions").insert({ id: cashSession.id, payload: cashSession, opened_at: cashSession.openedAt, updated_at: cashSession.openedAt });
    if (error) {
      window.alert("No se pudo abrir la caja. Puede que ya exista otra caja abierta.");
      return;
    }
    setState((current) => ({ ...current, cashSessions: [...current.cashSessions, cashSession] }));
    setManagementMode(null);
  }

  function addCashMovement(cashSession: CashSession, movement: Omit<CashMovement, "id" | "createdAt">) {
    const nextMovement: CashMovement = { ...movement, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    mutate({
      ...state,
      cashSessions: state.cashSessions.map((cash) => cash.id === cashSession.id ? { ...cash, movements: [...cash.movements, nextMovement] } : cash),
    });
    setMovementCash(null);
  }

  async function closeCash(cashSession: CashSession, countedAmount: number) {
    const expectedAmount = cashExpected(cashSession, state.sales);
    const closed: CashSession = {
      ...cashSession,
      status: "cerrada",
      closedAt: new Date().toISOString(),
      closedBy: session?.user.email ?? "Usuario",
      countedAmount,
      expectedAmount,
      difference: countedAmount - expectedAmount,
    };
    const { error } = await supabase.from("cash_sessions").upsert({ id: closed.id, payload: closed, opened_at: closed.openedAt, closed_at: closed.closedAt, updated_at: closed.closedAt });
    if (error) {
      window.alert("No se pudo cerrar la caja. Intenta nuevamente.");
      return;
    }
    setState((current) => ({ ...current, cashSessions: current.cashSessions.map((cash) => cash.id === closed.id ? closed : cash) }));
    setClosingCash(null);
    printCashClose(state.settings, closed, state.sales);
  }

  function setTableStatus(tableId: string, status: TableStatus) {
    mutate({
      ...state,
      tables: state.tables.map((table) => table.id === tableId ? { ...table, status } : table),
    });
  }

  function deleteTable(tableId: string) {
    const table = state.tables.find((entry) => entry.id === tableId);
    if (!table) return;
    if (table.items.length && !window.confirm(`La ${table.name} tiene un pedido. Queres eliminarla igualmente?`)) return;
    const remaining = state.tables.filter((entry) => entry.id !== tableId);
    mutate({ ...state, tables: remaining });
    setSelectedTableId(remaining[0]?.id ?? "");
  }

  async function saveProduct(product: Product) {
    const barcodes = [...new Set(product.barcodes.map((barcode) => barcode.trim()).filter(Boolean))];
    const duplicateBarcode = barcodes.find((barcode) => state.products.some((entry) => entry.area === "drugstore" && entry.barcodes.includes(barcode) && entry.id !== product.id));
    if (duplicateBarcode) {
      window.alert(`El codigo ${duplicateBarcode} ya pertenece a otro producto.`);
      return;
    }
    const normalized = { ...product, barcodes, id: product.id || crypto.randomUUID(), price: Number(product.price), stock: Number(product.stock), min: Number(product.min) };
    const { error } = await supabase.from("products").upsert({ id: normalized.id, payload: normalized, updated_at: new Date().toISOString() });
    if (error) {
      setSyncError("No se pudo guardar el producto ni sus codigos.");
      window.alert("No se pudo guardar. Revisa la conexion e intenta nuevamente.");
      return;
    }
    setState((current) => {
      const exists = current.products.some((entry) => entry.id === normalized.id);
      return {
        ...current,
        products: exists ? current.products.map((entry) => entry.id === normalized.id ? normalized : entry) : [...current.products, normalized],
      };
    });
    setSyncError("");
    setEditingProduct(null);
  }

  function processBarcode(barcode: string, showNotFound: boolean) {
    if (!barcode) return false;
    const now = Date.now();
    if (lastProcessedBarcodeRef.current.code === barcode && now - lastProcessedBarcodeRef.current.time < 200) return false;
    const product = state.products.find((entry) => entry.area === "drugstore" && entry.barcodes.includes(barcode));
    if (!product) {
      if (showNotFound) setBarcodeMessage("Codigo no registrado.");
      return false;
    }
    lastProcessedBarcodeRef.current = { code: barcode, time: now };
    addLine(product.id, "drugstoreCart");
    setBarcodeMessage(product.stock <= 0 ? `${product.name} agregado. El stock quedara en negativo.` : `${product.name} agregado al ticket.`);
    setBarcodeInput("");
    barcodeValueRef.current = "";
    window.requestAnimationFrame(() => barcodeInputRef.current?.focus());
    return true;
  }

  function scanBarcode() {
    if (barcodeDetectionTimerRef.current) clearTimeout(barcodeDetectionTimerRef.current);
    processBarcode(barcodeValueRef.current.trim(), true);
  }

  function handleBarcodeInput(value: string) {
    setBarcodeInput(value);
    barcodeValueRef.current = value;
    setBarcodeMessage("");
    if (barcodeDetectionTimerRef.current) clearTimeout(barcodeDetectionTimerRef.current);
    const barcode = value.trim();
    if (barcode) barcodeDetectionTimerRef.current = setTimeout(() => processBarcode(barcode, false), 70);
  }

  function deleteProduct(productId: string) {
    const product = state.products.find((entry) => entry.id === productId);
    if (!product) return;
    const isInTable = state.tables.some((table) => table.items.some((item) => item.productId === productId));
    if (isInTable) {
      window.alert("Ese producto esta en una mesa abierta.");
      return;
    }
    if (!window.confirm(`Queres borrar ${product.name}? Esta accion no se puede deshacer.`)) return;
    mutate({ ...state, products: state.products.filter((product) => product.id !== productId) });
    setDrugstoreCart((items) => items.filter((item) => item.productId !== productId));
    setBarCart((items) => items.filter((item) => item.productId !== productId));
  }

  function addStock(productId: string, quantity: number) {
    if (quantity <= 0) return;
    mutate({
      ...state,
      products: state.products.map((product) => product.id === productId ? { ...product, stock: product.stock + quantity } : product),
    });
    setStockProduct(null);
  }

  if (!isSupabaseConfigured) return <SystemMessage title="Falta configurar Supabase" text="Agrega las variables de Supabase para iniciar el sistema." />;
  if (authLoading) return <SystemMessage title="Iniciando" text="Conectando con el sistema..." />;
  if (!session) return <LoginScreen />;
  if (dataLoading) return <SystemMessage title="Cargando datos" text="Preparando productos, mesas y ventas..." />;

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.headerBrand}>
            <button className={styles.logoButton} onClick={() => { setView("dashboard"); setManagementMode(null); }} aria-label="Volver al inicio">
              <Image className={styles.brandLogo} src="/al-toque-logo.png" alt="Al toque" width={72} height={72} priority />
            </button>
            <div>
              <span>Bar · Cafeteria</span>
              <h1>{view === "dashboard" ? "Al toque" : title}</h1>
              <p>{view === "dashboard" ? "Elegí con qué módulo trabajar." : subtitle}</p>
            </div>
          </div>
          <div className={styles.topActions}>
            {view !== "dashboard" && <button className={`${styles.textButton} ${styles.homeButton}`} onClick={() => { setView("dashboard"); setManagementMode(null); }}>Inicio</button>}
            <button className={styles.textButton} onClick={() => setView("reports")}>Reportes</button>
            <button className={styles.textButton} onClick={() => setView("settings")}>Ajustes</button>
            <button className={styles.textButton} onClick={() => void supabase.auth.signOut()}>Salir</button>
          </div>
        </header>

        {syncError && <div className={styles.syncError}>{syncError}</div>}

        {view === "dashboard" && (
          <>
            <div className={styles.moduleChoiceGrid}>
              <button className={`${styles.moduleChoice} ${styles.drugstoreChoice}`} onClick={() => { setView("drugstore"); setManagementMode(null); }}>
                <span>Entrar a</span>
                <strong>Drugstore</strong>
                <small>{money(todayDrugstoreSales.reduce((sum, sale) => sum + sale.total, 0))} vendidos hoy</small>
              </button>
              <button className={`${styles.moduleChoice} ${styles.barChoice}`} onClick={() => { setView("bar"); setManagementMode(null); }}>
                <span>Entrar a</span>
                <strong>Bar</strong>
                <small>{openTables.length} mesas con pedido</small>
              </button>
            </div>
          </>
        )}

        {view === "drugstore" && !openDrugstoreCash && managementMode !== "drugstore" && <CashOpen area="drugstore" onOpen={(amount) => openCash("drugstore", amount)} onManage={() => { setManagementMode("drugstore"); setDrugstoreOption("stock"); }} />}

        {view === "drugstore" && (openDrugstoreCash || managementMode === "drugstore") && (
          <>
          {openDrugstoreCash && <CashBar cashSession={openDrugstoreCash} sales={state.sales} onMovement={() => setMovementCash(openDrugstoreCash)} onClose={() => setClosingCash(openDrugstoreCash)} />}
          <section className={styles.drugstoreSection}>
            <div className={styles.drugstoreNav}>
              <SegmentedControl
                tone="drugstore"
                options={!openDrugstoreCash ? [["stock", "Control de stock"]] : [
                  ["venta", "Venta y tickets"],
                  ["stock", lowDrugstoreStock.length > 0 ? `Control de stock - ${lowDrugstoreStock.length} alertas` : "Control de stock"],
                ]}
                value={drugstoreOption}
                onChange={(value) => setDrugstoreOption(value as DrugstoreOption)}
              />
            </div>
            <div className={styles.drugstoreContent}>
              {drugstoreOption === "venta" && (
                <div className={styles.drugstoreSaleLayout}>
                  <Panel title="Productos" variant="catalog">
                    <form className={styles.barcodeScanner} onSubmit={(event) => { event.preventDefault(); scanBarcode(); }}>
                      <label>Codigo de barras<input ref={barcodeInputRef} autoFocus autoComplete="off" inputMode="numeric" value={barcodeInput} onChange={(event) => handleBarcodeInput(event.target.value)} placeholder="Escanear o escribir codigo" /></label>
                      <button className={styles.scanButton}>Agregar</button>
                    </form>
                    {barcodeMessage && <p className={styles.barcodeMessage}>{barcodeMessage}</p>}
                    <div className={styles.catalogDivider}><span>Buscar manualmente</span></div>
                    <input type="search" placeholder="Buscar producto..." value={saleSearch} onChange={(event) => setSaleSearch(event.target.value)} />
                    <ProductGrid products={filteredDrugstoreSaleProducts} onPick={(id) => addLine(id, "drugstoreCart")} showStock hideCategory />
                  </Panel>
                  <SaleTicket cart={drugstoreCart} customer={drugstoreCustomer} payment={drugstorePayment} cartSum={drugstoreCartSum} setCart={setDrugstoreCart} setCustomer={setDrugstoreCustomer} setPayment={setDrugstorePayment} onQty={(id, delta) => changeQty(id, delta, "drugstoreCart")} onFinish={() => finishSale("drugstore")} />
                </div>
              )}
              {drugstoreOption === "stock" && (
                <div className={styles.inventoryLayout}>
                  <ProductTable
                    title="Inventario"
                    products={drugstoreProducts}
                    onAdd={() => setEditingProduct({ ...blankProduct, area: "drugstore" })}
                    onEdit={setEditingProduct}
                    onDelete={deleteProduct}
                    onAddStock={setStockProduct}
                    onViewBarcodes={setBarcodeProduct}
                    variant="inventory"
                    hideCategory
                    pageSize={20}
                  />
                  {lowDrugstoreStock.length > 0 && (
                    <Panel title="Necesitan reposicion" variant="alert">
                      {lowDrugstoreStock.map((product) => <ListItem key={product.id} title={product.name} meta={`Quedan ${product.stock}. Minimo sugerido: ${product.min}`} />)}
                    </Panel>
                  )}
                </div>
              )}
            </div>
          </section>
          </>
        )}

        {view === "bar" && !openBarCash && managementMode !== "bar" && <CashOpen area="bar" onOpen={(amount) => openCash("bar", amount)} onManage={() => { setManagementMode("bar"); setBarOption("menu"); }} />}

        {view === "bar" && (openBarCash || managementMode === "bar") && (
          <>
          {openBarCash && <CashBar cashSession={openBarCash} sales={state.sales} onMovement={() => setMovementCash(openBarCash)} onClose={() => setClosingCash(openBarCash)} />}
          <section className={styles.barSection}>
            <div className={styles.barNav}>
              <SegmentedControl
                tone="bar"
                options={!openBarCash ? [["menu", "Gestionar menu"]] : [
                  ["mesas", "Mesas y pedidos"],
                  ["menu", "Menu"],
                  ["venta", "Venta barra"],
                ]}
                value={barOption}
                onChange={(value) => setBarOption(value as BarOption)}
              />
            </div>
            <div className={styles.barContent}>
            {barOption === "mesas" && (
              <div className={styles.tablesWorkspace}>
                <Panel title="Mesas" action={<button className={styles.primaryCompact} onClick={() => {
                  const table = { id: crypto.randomUUID(), name: nextTableName(state.tables), status: "vacio" as TableStatus, items: [] };
                  mutate({ ...state, tables: [...state.tables, table].sort(compareTables) });
                  setSelectedTableId(table.id);
                }}>Nueva mesa</button>}>
                  <div className={styles.tableGrid}>
                    {state.tables.map((table) => (
                      <button key={table.id} className={`${styles.tableCard} ${tableStatusCardClass(table.status)} ${selectedTableId === table.id ? styles.selected : ""}`} onClick={() => setSelectedTableId(table.id)}>
                        <strong>{table.name}</strong>
                        <span className={`${styles.statusPill} ${statusClass(table.status)}`}>{statusLabel(table.status)}</span>
                        <span>{table.items.length} items</span>
                        <span>{money(total(table.items))}</span>
                      </button>
                    ))}
                  </div>
                </Panel>
                <div className={styles.tableOrderColumn}>
                  <Panel title={`Agregar al pedido - ${selectedTable?.name ?? "mesa"}`}>
                    <input type="search" placeholder="Buscar en menu..." value={barSearch} onChange={(event) => setBarSearch(event.target.value)} />
                    <ProductGrid products={filteredMenu} onPick={(id) => addLine(id, "table")} compact hideCategory />
                  </Panel>
                  <Panel title={`Ticket - ${selectedTable?.name ?? "mesa"}`} action={<div className={styles.rowActions}><button className={styles.smallButton} onClick={() => selectedTable && deleteTable(selectedTable.id)}>Eliminar mesa</button><button className={styles.primaryCompact} onClick={closeTable}>Cobrar mesa</button></div>} sticky>
                    <div className={styles.statusActions}>
                      <button disabled={Boolean(selectedTable?.items.length)} className={`${styles.emptyStatusButton} ${selectedTable?.status === "vacio" ? styles.statusActive : ""}`} onClick={() => selectedTable && setTableStatus(selectedTable.id, "vacio")}>Vacio</button>
                      <button disabled={!selectedTable?.items.length} className={`${styles.preparingStatusButton} ${selectedTable?.status === "preparacion" ? styles.statusActive : ""}`} onClick={() => selectedTable && setTableStatus(selectedTable.id, "preparacion")}>En preparacion</button>
                      <button disabled={!selectedTable?.items.length} className={`${styles.deliveredStatusButton} ${selectedTable?.status === "entregado" ? styles.statusActive : ""}`} onClick={() => selectedTable && setTableStatus(selectedTable.id, "entregado")}>Entregado</button>
                    </div>
                    <Cart items={selectedTable?.items ?? []} onQty={(id, delta) => changeQty(id, delta, "table")} />
                    <div className={styles.checkoutFooter}><label>Forma de pago<select value={tablePayment} onChange={(event) => setTablePayment(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Cuenta corriente</option></select></label><Total label="Total mesa" value={tableSum} /></div>
                  </Panel>
                </div>
              </div>
            )}
            {barOption === "menu" && (
              <>
                <ProductTable
                  title="Menu del bar"
                  products={barProducts}
                  onAdd={() => setEditingProduct({ ...blankProduct, area: "bar" })}
                  onEdit={setEditingProduct}
                  onDelete={deleteProduct}
                  menuOnly
                  hideCategory
                  pageSize={20}
                />
              </>
            )}
            {barOption === "venta" && (
              <div className={styles.workGrid}>
                <Panel title="Venta barra">
                  <input type="search" placeholder="Buscar item del bar..." value={saleSearch} onChange={(event) => setSaleSearch(event.target.value)} />
                  <ProductGrid products={filteredBarSaleProducts} onPick={(id) => addLine(id, "barCart")} hideCategory />
                </Panel>
                <SaleTicket cart={barCart} customer={barCustomer} payment={barPayment} cartSum={barCartSum} setCart={setBarCart} setCustomer={setBarCustomer} setPayment={setBarPayment} onQty={(id, delta) => changeQty(id, delta, "barCart")} onFinish={() => finishSale("bar")} />
              </div>
            )}
            </div>
          </section>
          </>
        )}

        {view === "reports" && (
          <>
            <section className={styles.dailyReportSection}>
              <div className={styles.reportDateBar}>
                <div>
                  <span>Resumen diario</span>
                  <h2>Que se vendio</h2>
                </div>
                <label>Elegir fecha<input type="date" value={reportDate} max={dateKey(new Date())} onChange={(event) => setReportDate(event.target.value)} /></label>
              </div>
              <div className={styles.dailySalesGrid}>
                <Panel title="Drugstore"><DailyItems sales={selectedDayDrugstoreSales} /></Panel>
                <Panel title="Bar"><DailyItems sales={selectedDayBarSales} /></Panel>
              </div>
            </section>
            <div className={styles.twoColumn}>
              <Panel title="Ventas por area"><AreaReport sales={state.sales} /></Panel>
              <Panel title="Mas vendidos"><TopItems sales={state.sales} /></Panel>
            </div>
            <div className={styles.reportsBillingGrid}>
              <SalesTable title="Tickets caja actual - Drugstore" sales={currentDrugstoreSales} settings={state.settings} />
              <SalesTable title="Tickets caja actual - Bar" sales={currentBarSales} settings={state.settings} />
            </div>
            <CashHistory cashSessions={state.cashSessions} sales={state.sales} settings={state.settings} />
          </>
        )}

        {view === "settings" && (
          <Panel title="Datos del local" narrow>
            <SettingsForm state={state} onSave={(settings) => mutate({ ...state, settings })} />
          </Panel>
        )}

      </main>

      {editingProduct && <ProductModal product={editingProduct} onCancel={() => setEditingProduct(null)} onSave={saveProduct} />}
      {stockProduct && <StockModal product={stockProduct} onCancel={() => setStockProduct(null)} onSave={(quantity) => addStock(stockProduct.id, quantity)} />}
      {barcodeProduct && <BarcodeListModal product={barcodeProduct} onClose={() => setBarcodeProduct(null)} />}
      {movementCash && <CashMovementModal cashSession={movementCash} onCancel={() => setMovementCash(null)} onSave={(movement) => addCashMovement(movementCash, movement)} />}
      {closingCash && <CashCloseModal cashSession={closingCash} sales={state.sales} onCancel={() => setClosingCash(null)} onClose={(countedAmount) => closeCash(closingCash, countedAmount)} />}
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <main className={styles.accessPage}>
      <form className={styles.accessPanel} onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) setError("Correo o contrasena incorrectos.");
        setLoading(false);
      }}>
        <Image className={styles.accessLogo} src="/al-toque-logo.png" alt="Al toque" width={104} height={104} priority />
        <div><span>Acceso del personal</span><h1>Al toque</h1></div>
        <label>Correo<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Contrasena<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className={styles.formError}>{error}</p>}
        <button className={styles.primaryButton} disabled={loading}>{loading ? "Ingresando..." : "Ingresar"}</button>
      </form>
    </main>
  );
}

function SystemMessage({ title, text }: { title: string; text: string }) {
  return <main className={styles.accessPage}><section className={styles.systemMessage}><Image className={styles.accessLogo} src="/al-toque-logo.png" alt="Al toque" width={88} height={88} priority /><h1>{title}</h1><p>{text}</p></section></main>;
}

function CashOpen({ area, onOpen, onManage }: { area: Area; onOpen: (amount: number) => void | Promise<void>; onManage: () => void }) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  return <section className={styles.cashOpen}><div><span>Caja cerrada</span><h2>Abrir caja de {labelArea(area)}</h2><p>Ingresa el efectivo disponible al comenzar este turno.</p></div><form onSubmit={async (event) => { event.preventDefault(); setLoading(true); await onOpen(Number(amount || 0)); setLoading(false); }}><label>Efectivo inicial<input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="$ 0" /></label><button className={styles.primaryButton} disabled={loading}>{loading ? "Abriendo..." : "Abrir caja"}</button><div className={styles.cashOpenDivider}><span>o continuar sin vender</span></div><button type="button" className={styles.manageOnlyButton} onClick={onManage}>{area === "drugstore" ? "Control de stock" : "Gestionar menu"}</button></form></section>;
}

function CashBar({ cashSession, sales, onMovement, onClose }: { cashSession: CashSession; sales: Sale[]; onMovement: () => void; onClose: () => void }) {
  const sessionSales = sales.filter((sale) => sale.cashSessionId === cashSession.id);
  return <section className={styles.cashBar}><div><span>Caja abierta</span><strong>{labelArea(cashSession.area)}</strong><small>Desde {date(cashSession.openedAt)} - {cashSession.openedBy}</small></div><div className={styles.cashBarMetrics}><div><span>Ventas</span><strong>{money(sessionSales.reduce((sum, sale) => sum + sale.total, 0))}</strong></div><div><span>Efectivo esperado</span><strong>{money(cashExpected(cashSession, sales))}</strong></div></div><div className={styles.cashBarActions}><button className={styles.smallButton} onClick={onMovement}>Registrar movimiento</button><button className={styles.closeCashButton} onClick={onClose}>Cerrar caja</button></div></section>;
}

function CashMovementModal({ cashSession, onCancel, onSave }: { cashSession: CashSession; onCancel: () => void; onSave: (movement: Omit<CashMovement, "id" | "createdAt">) => void }) {
  const [type, setType] = useState<CashMovement["type"]>("gasto");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return <div className={styles.modalBackdrop}><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); onSave({ type, amount: Number(amount), reason }); }}><h2>Movimiento de caja</h2><div className={styles.stockSummary}><strong>{labelArea(cashSession.area)}</strong><span>Caja abierta</span></div><label>Tipo<select value={type} onChange={(event) => setType(event.target.value as CashMovement["type"])}><option value="ingreso">Ingreso de efectivo</option><option value="gasto">Gasto</option><option value="retiro">Retiro de efectivo</option></select></label><label>Importe<input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Motivo<input required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej: pago a proveedor" /></label><div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.primaryCompact}>Guardar movimiento</button></div></form></div>;
}

function CashCloseModal({ cashSession, sales, onCancel, onClose }: { cashSession: CashSession; sales: Sale[]; onCancel: () => void; onClose: (countedAmount: number) => void | Promise<void> }) {
  const [counted, setCounted] = useState("");
  const [loading, setLoading] = useState(false);
  const expected = cashExpected(cashSession, sales);
  const difference = counted === "" ? null : Number(counted) - expected;
  const sessionSales = sales.filter((sale) => sale.cashSessionId === cashSession.id);
  return <div className={styles.modalBackdrop}><form className={`${styles.modal} ${styles.cashCloseModal}`} onSubmit={async (event) => { event.preventDefault(); setLoading(true); await onClose(Number(counted)); setLoading(false); }}><h2>Cerrar caja de {labelArea(cashSession.area)}</h2><div className={styles.cashCloseSummary}><Total label="Efectivo inicial" value={cashSession.openingAmount} /><Total label="Ventas en efectivo" value={paymentTotal(sessionSales, "Efectivo")} /><Total label="Transferencias" value={paymentTotal(sessionSales, "Transferencia")} /><Total label="Tarjetas" value={paymentTotal(sessionSales, "Tarjeta")} /><Total label="Ingresos" value={movementTotal(cashSession, "ingreso")} /><Total label="Gastos" value={movementTotal(cashSession, "gasto")} /><Total label="Retiros" value={movementTotal(cashSession, "retiro")} /><div className={styles.expectedCash}><span>Efectivo esperado</span><strong>{money(expected)}</strong></div></div><label>Efectivo contado<input autoFocus required type="number" min="0" step="0.01" value={counted} onChange={(event) => setCounted(event.target.value)} /></label>{difference !== null && <div className={`${styles.cashDifference} ${difference === 0 ? styles.exactCash : difference < 0 ? styles.missingCash : styles.extraCash}`}><span>Diferencia</span><strong>{money(difference)}</strong></div>}<div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.closeCashButton} disabled={loading}>{loading ? "Cerrando..." : "Confirmar cierre"}</button></div></form></div>;
}

function CashHistory({ cashSessions, sales, settings }: { cashSessions: CashSession[]; sales: Sale[]; settings: AppState["settings"] }) {
  const [closeDate, setCloseDate] = useState("");
  const [selectedCashId, setSelectedCashId] = useState("");
  const [page, setPage] = useState(1);
  const closed = cashSessions.filter((cash) => cash.status === "cerrada").sort((a, b) => new Date(b.closedAt ?? 0).getTime() - new Date(a.closedAt ?? 0).getTime());
  const filtered = closeDate ? closed.filter((cash) => cash.closedAt && dateKey(new Date(cash.closedAt)) === closeDate) : closed;
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages);
  const visibleCashSessions = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const selectedCash = closed.find((cash) => cash.id === selectedCashId);
  const archivedSales = selectedCash ? sales.filter((sale) => sale.cashSessionId === selectedCash.id) : [];

  return <section className={styles.cashHistorySection}>
    <div className={styles.cashHistoryHeader}><div><span>Archivo de cajas</span><h2>Cierres anteriores</h2></div><div className={styles.cashDateFilter}><label>Fecha de cierre<input type="date" value={closeDate} max={dateKey(new Date())} onChange={(event) => { setCloseDate(event.target.value); setPage(1); }} /></label>{closeDate && <button className={styles.smallButton} onClick={() => { setCloseDate(""); setPage(1); }}>Ver todas</button>}</div></div>
    <Panel title={`Historial de cierres (${filtered.length})`}>
      <div className={styles.tableWrap}><table><thead><tr><th>Area</th><th>Responsable</th><th>Apertura</th><th>Cierre</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th /></tr></thead><tbody>{visibleCashSessions.map((cash) => <tr key={cash.id}><td>{labelArea(cash.area)}</td><td>{cash.closedBy ?? cash.openedBy}</td><td>{date(cash.openedAt)}</td><td>{cash.closedAt ? date(cash.closedAt) : "-"}</td><td>{money(cash.expectedAmount ?? 0)}</td><td>{money(cash.countedAmount ?? 0)}</td><td className={(cash.difference ?? 0) < 0 ? styles.low : ""}>{money(cash.difference ?? 0)}</td><td><div className={styles.rowActions}><button className={styles.smallButton} onClick={() => setSelectedCashId(cash.id)}>Ver tickets</button><button className={styles.smallButton} onClick={() => printCashClose(settings, cash, sales)}>Reimprimir cierre</button></div></td></tr>)}</tbody></table></div>
      <ListEmpty show={!filtered.length} text={closed.length ? "No hay cierres en esa fecha." : "Todavia no hay cierres de caja."} />
      {totalPages > 1 && <div className={styles.pagination}><button className={styles.smallButton} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><strong>Pagina {currentPage} de {totalPages}</strong><button className={styles.smallButton} disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>}
    </Panel>
    {selectedCash && <div className={styles.archivedTickets}><div className={styles.archiveTitle}><div><span>Caja archivada</span><h2>{labelArea(selectedCash.area)} - {selectedCash.closedAt ? date(selectedCash.closedAt) : ""}</h2></div><button className={styles.smallButton} onClick={() => setSelectedCashId("")}>Cerrar detalle</button></div><SalesTable title="Tickets de este cierre" sales={archivedSales} settings={settings} /></div>}
  </section>;
}

function SegmentedControl({ options, value, onChange, tone }: { options: [string, string][]; value: string; onChange: (value: string) => void; tone?: "drugstore" | "bar" }) {
  return (
    <div className={`${styles.segmentedControl} ${tone === "bar" ? styles.barTabs : styles.drugstoreTabs}`}>
      {options.map(([key, label]) => (
        <button key={key} className={`${value === key ? styles.segmentActive : ""} ${key === "stock" ? styles.stockTab : ""}`} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function SaleTicket({
  cart,
  customer,
  payment,
  cartSum,
  setCart,
  setCustomer,
  setPayment,
  onQty,
  onFinish,
}: {
  cart: LineItem[];
  customer: string;
  payment: string;
  cartSum: number;
  setCart: (items: LineItem[]) => void;
  setCustomer: (value: string) => void;
  setPayment: (value: string) => void;
  onQty: (id: string, delta: number) => void;
  onFinish: () => void;
}) {
  return (
    <Panel title="Ticket actual" action={<button className={styles.smallButton} onClick={() => setCart([])}>Vaciar</button>} sticky variant="ticket">
      <Cart items={cart} onQty={onQty} />
      <div className={styles.checkoutFooter}>
        <label>Cliente<input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Consumidor final" /></label>
        <label>Pago<select value={payment} onChange={(event) => setPayment(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Cuenta corriente</option></select></label>
        <Total label="Total" value={cartSum} />
        <button className={styles.primaryButton} onClick={onFinish}>Cobrar e imprimir</button>
      </div>
    </Panel>
  );
}

function ProductTable({ title, products, onAdd, onEdit, onDelete, onAddStock, onViewBarcodes, menuOnly = false, variant, hideCategory = false, pageSize }: { title: string; products: Product[]; onAdd: () => void; onEdit: (product: Product) => void; onDelete: (productId: string) => void; onAddStock?: (product: Product) => void; onViewBarcodes?: (product: Product) => void; menuOnly?: boolean; variant?: "inventory"; hideCategory?: boolean; pageSize?: number }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filteredProducts = pageSize
    ? products.filter((product) => normalize(`${product.name} ${product.barcodes.join(" ")}`).includes(normalize(query)))
    : products;
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / (pageSize ?? Math.max(1, filteredProducts.length))));
  const currentPage = Math.min(page, totalPages);
  const visibleProducts = pageSize ? filteredProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize) : filteredProducts;

  return (
    <Panel title={title} action={<button className={styles.primaryCompact} onClick={onAdd}>Agregar producto</button>} variant={variant}>
      {pageSize && <div className={styles.stockSearchBar}><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={onViewBarcodes ? "Buscar por nombre o codigo de barras..." : "Buscar por nombre..."} /><span>{filteredProducts.length} articulos</span></div>}
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Producto</th>{!hideCategory && <th>Categoria</th>}<th>Precio</th>{!menuOnly && <th>Stock</th>}{!menuOnly && <th>Min.</th>}<th /></tr></thead>
          <tbody>
            {visibleProducts.map((product) => (
              <tr key={product.id}>
                <td><strong>{product.name}</strong><br /><span>{labelArea(product.area)}</span></td>
                {!hideCategory && <td>{product.category}</td>}
                <td>{money(product.price)}</td>
                {!menuOnly && <td className={product.stock <= product.min ? styles.low : ""}>{product.stock}</td>}
                {!menuOnly && <td>{product.min}</td>}
                <td><div className={styles.rowActions}>{onViewBarcodes && <button className={styles.barcodeButton} onClick={() => onViewBarcodes(product)}>Ver codigos ({product.barcodes.length})</button>}{onAddStock && <button className={styles.stockButton} onClick={() => onAddStock(product)}>Agregar stock</button>}<button className={styles.smallButton} onClick={() => onEdit(product)}>Editar</button><button className={styles.smallButton} onClick={() => onDelete(product.id)}>Borrar</button></div></td>
              </tr>
            ))}
            {!visibleProducts.length && <tr><td colSpan={6}><div className={styles.empty}>No se encontraron productos.</div></td></tr>}
          </tbody>
        </table>
      </div>
      {pageSize && totalPages > 1 && <div className={styles.pagination}><button className={styles.smallButton} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><strong>Pagina {currentPage} de {totalPages}</strong><button className={styles.smallButton} disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>}
    </Panel>
  );
}

function Panel({ title, action, children, sticky, narrow, variant }: { title: string; action?: React.ReactNode; children: React.ReactNode; sticky?: boolean; narrow?: boolean; variant?: "catalog" | "ticket" | "inventory" | "alert" }) {
  const variantClass = variant ? styles[`${variant}Panel`] : "";
  return <section className={`${styles.panel} ${sticky ? styles.sticky : ""} ${narrow ? styles.narrow : ""} ${variantClass}`}><div className={styles.panelHeader}><h2>{title}</h2>{action}</div>{children}</section>;
}

function ProductGrid({ products, onPick, compact, showStock = false, hideCategory = false }: { products: Product[]; onPick: (id: string) => void; compact?: boolean; showStock?: boolean; hideCategory?: boolean }) {
  if (!products.length) return <div className={styles.empty}>Sin resultados.</div>;
  return <div className={`${styles.productGrid} ${compact ? styles.compactGrid : ""}`}>{products.map((product) => {
    const lowStock = product.area === "drugstore" && product.stock <= 0;
    return <button key={product.id} className={`${styles.productCard} ${lowStock ? styles.negativeStockCard : ""}`} onClick={() => onPick(product.id)}><strong>{product.name}</strong><span>{hideCategory ? money(product.price) : `${product.category} - ${money(product.price)}`}</span>{showStock && <span>Stock: {product.stock}</span>}</button>;
  })}</div>;
}

function Cart({ items, onQty }: { items: LineItem[]; onQty: (id: string, delta: number) => void }) {
  if (!items.length) return <div className={styles.empty}>El pedido esta vacio.</div>;
  return <div className={styles.cartList}>{items.map((item) => <div className={styles.cartItem} key={item.productId}><div><strong>{item.name}</strong><span>{item.qty} x {money(item.price)} = {money(item.qty * item.price)}</span></div><div className={styles.qtyControls}><button onClick={() => onQty(item.productId, -1)}>-</button><strong>{item.qty}</strong><button onClick={() => onQty(item.productId, 1)}>+</button></div></div>)}</div>;
}

function Total({ label, value }: { label: string; value: number }) {
  return <div className={styles.totalRow}><span>{label}</span><strong>{money(value)}</strong></div>;
}

function ListItem({ title, meta }: { title: string; meta: string }) {
  return <div className={styles.listItem}><strong>{title}</strong><span>{meta}</span></div>;
}

function ListEmpty({ show, text }: { show: boolean; text: string }) {
  return show ? <div className={styles.empty}>{text}</div> : null;
}

function SettingsForm({ state, onSave }: { state: AppState; onSave: (settings: AppState["settings"]) => void }) {
  const [settings, setSettings] = useState(state.settings);
  return <div className={styles.settingsForm}><label>Nombre del local<input value={settings.businessName} onChange={(event) => setSettings({ ...settings, businessName: event.target.value })} /></label><label>Direccion<input value={settings.businessAddress} onChange={(event) => setSettings({ ...settings, businessAddress: event.target.value })} /></label><label>Telefono<input value={settings.businessPhone} onChange={(event) => setSettings({ ...settings, businessPhone: event.target.value })} /></label><label>Texto al pie del ticket<input value={settings.ticketFooter} onChange={(event) => setSettings({ ...settings, ticketFooter: event.target.value })} /></label><button className={styles.primaryCompact} onClick={() => onSave(settings)}>Guardar ajustes</button></div>;
}

function ProductModal({ product, onCancel, onSave }: { product: Product; onCancel: () => void; onSave: (product: Product) => void }) {
  const [draft, setDraft] = useState(product);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [showBarcodes, setShowBarcodes] = useState(false);
  const isBar = draft.area === "bar";
  const isNewDrugstoreProduct = !isBar && !draft.id;
  const addBarcode = () => {
    const barcode = barcodeInput.trim();
    if (!barcode) return;
    setDraft((current) => current.barcodes.includes(barcode) ? current : { ...current, barcodes: [...current.barcodes, barcode] });
    setBarcodeInput("");
  };
  return (
    <div className={styles.modalBackdrop}>
      <form className={styles.modal} onSubmit={(event) => {
        event.preventDefault();
        const pendingBarcode = barcodeInput.trim();
        const barcodes = pendingBarcode && !draft.barcodes.includes(pendingBarcode) ? [...draft.barcodes, pendingBarcode] : draft.barcodes;
        onSave({ ...draft, barcodes, stock: isBar ? 999999 : draft.stock, min: isBar ? 0 : draft.min });
      }}>
        <h2>{draft.id ? "Editar producto" : "Agregar producto"}</h2>
        <label>Nombre<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: formatName(event.target.value) })} /></label>
        {!isBar && <div className={styles.barcodeEditor}>
          <label>Codigos de barras<input autoComplete="off" inputMode="numeric" value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addBarcode(); } }} placeholder="Escanear o escribir codigo" /></label>
          <button type="button" className={styles.barcodeButton} onClick={addBarcode}>Agregar codigo</button>
        </div>}
        {!isBar && draft.barcodes.length > 0 && <button type="button" className={styles.barcodeListToggle} onClick={() => setShowBarcodes((current) => !current)}>{showBarcodes ? "Ocultar codigos" : `Ver codigos (${draft.barcodes.length})`}</button>}
        {!isBar && showBarcodes && draft.barcodes.length > 0 && <div className={styles.barcodeDraftList}>{draft.barcodes.map((barcode) => <div key={barcode}><span>{barcode}</span><button type="button" onClick={() => setDraft((current) => ({ ...current, barcodes: current.barcodes.filter((entry) => entry !== barcode) }))}>Quitar</button></div>)}</div>}
        <label>Area<input value={labelArea(draft.area)} disabled /></label>
        <div className={isBar ? styles.formGridSingle : styles.formGrid}>
          <label>Precio<input type="number" min="0" value={draft.price || ""} onChange={(event) => setDraft({ ...draft, price: numberValue(event.target.value) })} /></label>
          {isNewDrugstoreProduct && <label>Stock inicial<input type="number" min="0" value={draft.stock || ""} onChange={(event) => setDraft({ ...draft, stock: numberValue(event.target.value) })} /></label>}
          {!isBar && <label>Minimo<input type="number" min="0" value={draft.min || ""} onChange={(event) => setDraft({ ...draft, min: numberValue(event.target.value) })} /></label>}
        </div>
        <div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.primaryCompact}>Guardar</button></div>
      </form>
    </div>
  );
}

function StockModal({ product, onCancel, onSave }: { product: Product; onCancel: () => void; onSave: (quantity: number) => void }) {
  const [quantity, setQuantity] = useState("");
  return <div className={styles.modalBackdrop}><form className={styles.modal} onSubmit={(event) => { event.preventDefault(); onSave(Number(quantity)); }}><h2>Agregar stock</h2><div className={styles.stockSummary}><strong>{product.name}</strong><span>Stock actual: {product.stock}</span></div><label>Cantidad que ingresa<input autoFocus required type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="Ej: 12" /></label><div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.stockButton}>Sumar al stock</button></div></form></div>;
}

function BarcodeListModal({ product, onClose }: { product: Product; onClose: () => void }) {
  return <div className={styles.modalBackdrop}><section className={styles.modal}><h2>Codigos de {product.name}</h2>{product.barcodes.length ? <div className={styles.barcodeFullList}>{product.barcodes.map((barcode, index) => <div key={barcode}><span>Codigo {index + 1}</span><strong>{barcode}</strong></div>)}</div> : <div className={styles.empty}>Este producto no tiene codigos cargados.</div>}<div className={styles.modalActions}><button className={styles.primaryCompact} onClick={onClose}>Cerrar</button></div></section></div>;
}

function AreaReport({ sales }: { sales: Sale[] }) {
  const totals = sales.reduce<Record<Area, number>>((acc, sale) => ({ ...acc, [sale.area]: acc[sale.area] + sale.total }), { drugstore: 0, bar: 0 });
  const max = Math.max(1, totals.drugstore, totals.bar);
  return <div className={styles.reportBars}>{(["drugstore", "bar"] as Area[]).map((area) => <div className={styles.barLine} key={area}><header><strong>{labelArea(area)}</strong><span>{money(totals[area])}</span></header><div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${(totals[area] / max) * 100}%` }} /></div></div>)}</div>;
}

function TopItems({ sales }: { sales: Sale[] }) {
  const items = new Map<string, number>();
  sales.forEach((sale) => sale.items.forEach((item) => items.set(item.name, (items.get(item.name) ?? 0) + item.qty)));
  const sorted = [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!sorted.length) return <div className={styles.empty}>Sin ventas registradas.</div>;
  return <>{sorted.map(([name, qty]) => <ListItem key={name} title={name} meta={`${qty} vendidos`} />)}</>;
}

function DailyItems({ sales }: { sales: Sale[] }) {
  const items = new Map<string, { qty: number; total: number }>();
  sales.forEach((sale) => sale.items.forEach((item) => {
    const current = items.get(item.name) ?? { qty: 0, total: 0 };
    items.set(item.name, { qty: current.qty + item.qty, total: current.total + item.qty * item.price });
  }));
  const sorted = [...items.entries()].sort((a, b) => b[1].qty - a[1].qty);
  if (!sorted.length) return <div className={styles.empty}>No hubo ventas en esta fecha.</div>;
  return <div className={styles.dailyItems}>{sorted.map(([name, item]) => <div className={styles.dailyItem} key={name}><div><strong>{name}</strong><span>{item.qty} vendidos</span></div><strong>{money(item.total)}</strong></div>)}<Total label="Total del dia" value={sales.reduce((sum, sale) => sum + sale.total, 0)} /></div>;
}

function SalesTable({ title, sales, settings }: { title: string; sales: Sale[]; settings: AppState["settings"] }) {
  const pageSize = 20;
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const sortedSales = sales.slice().reverse();
  const filteredSales = sortedSales.filter((sale) => normalize(`${sale.ticketNumber} ${sale.customer} ${sale.payment} ${date(sale.createdAt)}`).includes(normalize(query)));
  const totalPages = Math.max(1, Math.ceil(filteredSales.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleSales = filteredSales.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <Panel title={title}>
      <div className={styles.stockSearchBar}><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar ticket, cliente, pago o fecha..." /><span>{filteredSales.length} tickets</span></div>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>Ticket</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th>Total</th><th /></tr></thead>
          <tbody>
            {visibleSales.map((sale) => (
              <tr key={sale.id}><td>{sale.ticketNumber}</td><td>{date(sale.createdAt)}</td><td>{sale.customer}</td><td>{sale.payment}</td><td>{money(sale.total)}</td><td><button type="button" className={styles.smallButton} onClick={() => printTicket(settings, sale)}>Reimprimir</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <ListEmpty show={!filteredSales.length} text={sales.length ? "No se encontraron tickets." : "Sin facturacion registrada."} />
      {totalPages > 1 && <div className={styles.pagination}><button className={styles.smallButton} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><strong>Pagina {currentPage} de {totalPages}</strong><button className={styles.smallButton} disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>}
    </Panel>
  );
}

function filterProducts(products: Product[], area: Area, query: string) {
  const normalized = normalize(query);
  return products.filter((product) => product.area === area && normalize(`${product.name} ${product.category}`).includes(normalized));
}

function total(items: LineItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function paymentTotal(sales: Sale[], payment: string) {
  return sales.filter((sale) => sale.payment === payment).reduce((sum, sale) => sum + sale.total, 0);
}

function movementTotal(cashSession: CashSession, type: CashMovement["type"]) {
  return cashSession.movements.filter((movement) => movement.type === type).reduce((sum, movement) => sum + movement.amount, 0);
}

function cashExpected(cashSession: CashSession, sales: Sale[]) {
  const sessionSales = sales.filter((sale) => sale.cashSessionId === cashSession.id);
  return cashSession.openingAmount
    + paymentTotal(sessionSales, "Efectivo")
    + movementTotal(cashSession, "ingreso")
    - movementTotal(cashSession, "gasto")
    - movementTotal(cashSession, "retiro");
}

function money(value: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0);
}

function date(value: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isToday(value: string) {
  const dateValue = new Date(value);
  const now = new Date();
  return dateValue.getFullYear() === now.getFullYear() && dateValue.getMonth() === now.getMonth() && dateValue.getDate() === now.getDate();
}

function labelArea(area: Area) {
  return area === "bar" ? "Bar" : "Drugstore";
}

function statusLabel(status: TableStatus) {
  if (status === "vacio") return "Vacio";
  return status === "entregado" ? "Entregado" : "En preparacion";
}

function statusClass(status: TableStatus) {
  if (status === "vacio") return styles.emptyStatus;
  return status === "entregado" ? styles.delivered : styles.preparing;
}

function tableStatusCardClass(status: TableStatus) {
  if (status === "vacio") return styles.emptyTableCard;
  return status === "entregado" ? styles.deliveredTableCard : styles.preparingTableCard;
}

function nextTicketNumber(sales: Sale[], area: Area) {
  const prefix = area === "bar" ? "B" : "D";
  const next = sales.filter((sale) => sale.area === area).length + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

function nextTableName(tables: TableOrder[]) {
  const used = new Set(tables.map((table) => Number(table.name.match(/\d+/)?.[0] ?? 0)));
  let next = 1;
  while (used.has(next)) next += 1;
  return `Mesa ${next}`;
}

function compareTables(a: TableOrder, b: TableOrder) {
  const numberA = Number(a.name.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  const numberB = Number(b.name.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  return numberA - numberB || a.name.localeCompare(b.name, "es");
}

function normalizeState(state: AppState): AppState {
  return {
    ...state,
    products: state.products.map((product) => {
      const legacyProduct = product as Product & { barcode?: string };
      const barcodes = Array.isArray(legacyProduct.barcodes)
        ? legacyProduct.barcodes.filter(Boolean)
        : (legacyProduct.barcode ? [legacyProduct.barcode] : []);
      return product.area === "bar"
        ? { ...product, barcodes, stock: product.stock || 999999, min: 0 }
        : { ...product, barcodes };
    }),
    sales: state.sales.map((sale, index) => ({ ...sale, cashSessionId: sale.cashSessionId ?? "", ticketNumber: sale.ticketNumber || `${sale.area === "bar" ? "B" : "D"}-${String(index + 1).padStart(4, "0")}` })),
    tables: state.tables.map((table) => ({ ...table, status: table.items.length ? (table.status === "entregado" ? "entregado" : "preparacion") : "vacio" })),
    cashSessions: (state.cashSessions ?? []).map((cash) => ({ ...cash, openedBy: cash.openedBy ?? "Usuario", movements: cash.movements ?? [] })),
  };
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatName(value: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function numberValue(value: string) {
  return value === "" ? 0 : Number(value);
}

async function loadRemoteState(): Promise<AppState> {
  const [settingsResult, productsResult, salesResult, tablesResult, cashResult] = await Promise.all([
    supabase.from("app_settings").select("payload").eq("id", "business").maybeSingle(),
    supabase.from("products").select("payload"),
    supabase.from("sales").select("payload").order("created_at", { ascending: true }),
    supabase.from("bar_tables").select("payload"),
    supabase.from("cash_sessions").select("payload").order("opened_at", { ascending: true }),
  ]);
  const error = settingsResult.error || productsResult.error || salesResult.error || tablesResult.error || cashResult.error;
  if (error) throw error;

  let settings = settingsResult.data?.payload as AppState["settings"] | undefined;
  if (!settings) {
    settings = seedState.settings;
    const { error: settingsError } = await supabase.from("app_settings").upsert({ id: "business", payload: settings, updated_at: new Date().toISOString() });
    if (settingsError) throw settingsError;
  }

  return normalizeState({
    settings,
    products: (productsResult.data ?? []).map((row) => row.payload as Product),
    sales: (salesResult.data ?? []).map((row) => row.payload as Sale),
    tables: (tablesResult.data ?? []).map((row) => row.payload as TableOrder).sort(compareTables),
    cashSessions: (cashResult.data ?? []).map((row) => row.payload as CashSession),
  });
}

async function persistStateChanges(previous: AppState, next: AppState) {
  if (JSON.stringify(previous.settings) !== JSON.stringify(next.settings)) {
    const { error } = await supabase.from("app_settings").upsert({ id: "business", payload: next.settings, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  await Promise.all([
    syncRows("products", previous.products, next.products),
    syncRows("sales", previous.sales, next.sales),
    syncRows("bar_tables", previous.tables, next.tables),
    syncRows("cash_sessions", previous.cashSessions, next.cashSessions),
  ]);
}

async function syncRows<T extends { id: string }>(table: "products" | "sales" | "bar_tables" | "cash_sessions", previous: T[], next: T[]) {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const changed = next.filter((item) => JSON.stringify(previousById.get(item.id)) !== JSON.stringify(item));
  const nextIds = new Set(next.map((item) => item.id));
  const deletedIds = previous.filter((item) => !nextIds.has(item.id)).map((item) => item.id);

  if (changed.length) {
    const now = new Date().toISOString();
    const rows = changed.map((item) => {
      if (table === "sales") return { id: item.id, payload: item, created_at: (item as unknown as Sale).createdAt };
      if (table === "cash_sessions") {
        const cash = item as unknown as CashSession;
        return { id: item.id, payload: item, opened_at: cash.openedAt, closed_at: cash.closedAt ?? null, updated_at: now };
      }
      return { id: item.id, payload: item, updated_at: now };
    });
    const { error } = await supabase.from(table).upsert(rows);
    if (error) throw error;
  }
  if (deletedIds.length) {
    const { error } = await supabase.from(table).delete().in("id", deletedIds);
    if (error) throw error;
  }
}

function printTicket(settings: AppState["settings"], sale: Sale) {
  const old = document.getElementById("printTicket");
  old?.remove();
  const ticket = document.createElement("section");
  ticket.id = "printTicket";
  ticket.innerHTML = `<header><h2>${settings.businessName}</h2><p>${settings.businessAddress}</p>${settings.businessPhone ? `<p>${settings.businessPhone}</p>` : ""}</header><hr><div class="ticketMeta"><p>Ticket: ${sale.ticketNumber}</p><p>Fecha: ${date(sale.createdAt)}</p><p>Area: ${labelArea(sale.area)}</p><p>Cliente: ${sale.customer}</p></div><hr><div class="ticketItems">${sale.items.map((item) => `<div class="ticketItem"><strong>${item.name}</strong><div><span>${item.qty} x ${money(item.price)}</span><strong>${money(item.qty * item.price)}</strong></div></div>`).join("")}</div><hr><div class="ticketTotal"><span>TOTAL</span><strong>${money(sale.total)}</strong></div><p>Pago: ${sale.payment}</p><footer>${settings.ticketFooter}</footer>`;
  document.body.appendChild(ticket);
  window.requestAnimationFrame(() => window.print());
}

function printCashClose(settings: AppState["settings"], cashSession: CashSession, sales: Sale[]) {
  const old = document.getElementById("printTicket");
  old?.remove();
  const sessionSales = sales.filter((sale) => sale.cashSessionId === cashSession.id);
  const ticket = document.createElement("section");
  ticket.id = "printTicket";
  ticket.innerHTML = `<header><h2>${settings.businessName}</h2><p>CIERRE DE CAJA</p><p>${labelArea(cashSession.area)}</p></header><hr><div class="ticketMeta"><p>Apertura: ${date(cashSession.openedAt)}</p><p>Cierre: ${cashSession.closedAt ? date(cashSession.closedAt) : "Caja abierta"}</p><p>Operaciones: ${sessionSales.length}</p></div><hr><div class="ticketItems"><div class="ticketItem"><div><span>Efectivo inicial</span><strong>${money(cashSession.openingAmount)}</strong></div></div><div class="ticketItem"><div><span>Ventas efectivo</span><strong>${money(paymentTotal(sessionSales, "Efectivo"))}</strong></div></div><div class="ticketItem"><div><span>Transferencias</span><strong>${money(paymentTotal(sessionSales, "Transferencia"))}</strong></div></div><div class="ticketItem"><div><span>Tarjetas</span><strong>${money(paymentTotal(sessionSales, "Tarjeta"))}</strong></div></div><div class="ticketItem"><div><span>Ingresos</span><strong>${money(movementTotal(cashSession, "ingreso"))}</strong></div></div><div class="ticketItem"><div><span>Gastos</span><strong>-${money(movementTotal(cashSession, "gasto"))}</strong></div></div><div class="ticketItem"><div><span>Retiros</span><strong>-${money(movementTotal(cashSession, "retiro"))}</strong></div></div></div><hr><div class="ticketTotal"><span>ESPERADO</span><strong>${money(cashSession.expectedAmount ?? cashExpected(cashSession, sales))}</strong></div><div class="ticketTotal"><span>CONTADO</span><strong>${money(cashSession.countedAmount ?? 0)}</strong></div><div class="ticketTotal"><span>DIFERENCIA</span><strong>${money(cashSession.difference ?? 0)}</strong></div><footer>Cierre guardado en el sistema</footer>`;
  document.body.appendChild(ticket);
  window.requestAnimationFrame(() => window.print());
}
