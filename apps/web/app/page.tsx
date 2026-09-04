"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import styles from "./page.module.css";

type Area = "drugstore" | "bar";
type MenuCategory = "Comida" | "Bebidas" | "Postre";

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
  area?: Area;
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
  area: Area | "general";
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
  openedAt?: string;
};

type AppState = {
  settings: {
    businessName: string;
    businessAddress: string;
    businessPhone: string;
    ticketFooter: string;
    operationalCloseHour: string;
  };
  products: Product[];
  sales: Sale[];
  tables: TableOrder[];
  cashSessions: CashSession[];
};

type View = "dashboard" | "sales" | "tables" | "items" | "cash" | "reports" | "settings";
type SaleFilter = "all" | Area;
type MenuFilter = "Todos" | MenuCategory;
type TableFilter = "todas" | TableStatus;

const MAX_TABLES = 15;

const seedState: AppState = {
  settings: {
    businessName: "Al toque",
    businessAddress: "",
    businessPhone: "",
    ticketFooter: "Gracias por su compra",
    operationalCloseHour: "03:00",
  },
  products: [],
  sales: [],
  tables: [],
  cashSessions: [],
};

const viewCopy: Record<View, [string, string]> = {
  dashboard: ["Inicio", "Ventas, mesas, articulos y caja en un solo sistema."],
  sales: ["Vender", "Mostrador unificado para drugstore y bar."],
  tables: ["Mesas", "Pedidos del salon, estados y cobro por mesa."],
  items: ["Articulos", "Stock del drugstore y menu del bar."],
  cash: ["Caja", "Aperturas, movimientos y cierres."],
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

const menuCategories: MenuFilter[] = ["Todos", "Comida", "Bebidas", "Postre"];

export default function Home() {
  const [state, setState] = useState<AppState>(seedState);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [syncError, setSyncError] = useState("");
  const [cashLiveNotice, setCashLiveNotice] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [saleFilter, setSaleFilter] = useState<SaleFilter>("all");
  const [itemsArea, setItemsArea] = useState<Area>("drugstore");
  const [saleCart, setSaleCart] = useState<LineItem[]>([]);
  const [saleSearch, setSaleSearch] = useState("");
  const [tableMenuFilter, setTableMenuFilter] = useState<MenuFilter>("Comida");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeMessage, setBarcodeMessage] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const barcodeValueRef = useRef("");
  const barcodeDetectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProcessedBarcodeRef = useRef({ code: "", time: 0 });
  const [barSearch, setBarSearch] = useState("");
  const [saleCustomer, setSaleCustomer] = useState("");
  const [salePayment, setSalePayment] = useState("Efectivo");
  const [tablePayment, setTablePayment] = useState("Efectivo");
  const [tableStatusFilter, setTableStatusFilter] = useState<TableFilter>("todas");
  const [reportDate, setReportDate] = useState(() => businessDateKey(new Date(), seedState.settings.operationalCloseHour));
  const [selectedTableId, setSelectedTableId] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);
  const [closingCash, setClosingCash] = useState<CashSession | null>(null);
  const [movementCash, setMovementCash] = useState<CashSession | null>(null);
  const [cashOpeningAnimation, setCashOpeningAnimation] = useState(false);
  const [cashClosingAnimation, setCashClosingAnimation] = useState(false);
  const [, setClockTick] = useState(0);
  const saleInProgressRef = useRef(false);
  const cashLiveNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localCashChangeUntilRef = useRef(0);

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
    let loadedOnce = false;
    let lastOpenCashId = "";
    const refresh = async () => {
      try {
        const remoteState = await loadRemoteState();
        if (!active) return;
        const nextOpenCash = currentOpenCashSession(remoteState.cashSessions, remoteState.settings.operationalCloseHour);
        const isLocalCashChange = Date.now() < localCashChangeUntilRef.current;
        if (loadedOnce && !isLocalCashChange && nextOpenCash?.id !== lastOpenCashId) {
          if (!nextOpenCash && lastOpenCashId) {
            notifyCashLiveChange("La caja fue cerrada en otra computadora. Abran una nueva caja para seguir vendiendo.");
            setClosingCash(null);
            setMovementCash(null);
          } else if (nextOpenCash && !lastOpenCashId) {
            notifyCashLiveChange("Se abrio una caja en otra computadora. El sistema ya esta actualizado.");
          } else if (nextOpenCash && lastOpenCashId && nextOpenCash.id !== lastOpenCashId) {
            notifyCashLiveChange("La caja activa cambio en otra computadora. Revisa antes de cobrar.");
            setClosingCash(null);
            setMovementCash(null);
          }
        }
        loadedOnce = true;
        lastOpenCashId = nextOpenCash?.id ?? "";
        setState(remoteState);
        setSelectedTableId((current) => remoteState.tables.some((table) => table.id === current) ? current : "");
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

  useEffect(() => () => {
    if (cashLiveNoticeTimerRef.current) clearTimeout(cashLiveNoticeTimerRef.current);
  }, []);

  useEffect(() => {
    if (view !== "sales") return;
    window.requestAnimationFrame(() => barcodeInputRef.current?.focus());
  }, [view, saleCart]);

  useEffect(() => () => {
    if (barcodeDetectionTimerRef.current) clearTimeout(barcodeDetectionTimerRef.current);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((current) => current + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const openCashSession = currentOpenCashSession(state.cashSessions, state.settings.operationalCloseHour);
  const pendingOpenCashSessions = hiddenOpenCashSessions(state.cashSessions, openCashSession);
  const currentBusinessDate = businessDateKey(new Date(), state.settings.operationalCloseHour);
  const currentSales = openCashSession ? state.sales.filter((sale) => sale.cashSessionId === openCashSession.id && businessDateKey(new Date(sale.createdAt), state.settings.operationalCloseHour) === currentBusinessDate) : [];
  const openCashSales = openCashSession ? state.sales.filter((sale) => sale.cashSessionId === openCashSession.id) : [];
  const currentDrugstoreSales = currentSales.filter((sale) => sale.area === "drugstore");
  const currentBarSales = currentSales.filter((sale) => sale.area === "bar");
  const selectedDaySales = state.sales.filter((sale) => businessDateKey(new Date(sale.createdAt), state.settings.operationalCloseHour) === reportDate);
  const selectedDayDrugstoreSales = selectedDaySales.filter((sale) => sale.area === "drugstore");
  const selectedDayBarSales = selectedDaySales.filter((sale) => sale.area === "bar");
  const lowDrugstoreStock = state.products.filter((product) => product.area === "drugstore" && product.stock <= product.min);
  const selectedTable = state.tables.find((table) => table.id === selectedTableId);
  const filteredSaleProducts = filterSaleProducts(state.products, saleFilter, saleSearch);
  const filteredMenu = filterMenuProducts(state.products, barSearch, tableMenuFilter);
  const drugstoreProducts = state.products.filter((product) => product.area === "drugstore");
  const barProducts = state.products.filter((product) => product.area === "bar");
  const saleCartSum = total(saleCart);
  const tableSum = total(selectedTable?.items ?? []);
  const [title, subtitle] = viewCopy[view];
  const cashNotice = openCashSession ? cashSessionNotice(openCashSession, state.settings.operationalCloseHour) : null;

  function mutate(next: AppState) {
    const previous = state;
    setState(next);
    setSyncError("");
    void persistStateChanges(previous, next).catch(() => setSyncError("No se pudieron guardar los cambios."));
  }

  function notifyCashLiveChange(message: string) {
    setCashLiveNotice(message);
    if (cashLiveNoticeTimerRef.current) clearTimeout(cashLiveNoticeTimerRef.current);
    cashLiveNoticeTimerRef.current = setTimeout(() => setCashLiveNotice(""), 9000);
  }

  function addLine(productId: string, target: "saleCart" | "table") {
    if (saleInProgressRef.current) return;
    const product = state.products.find((entry) => entry.id === productId);
    if (!product) return;

    const apply = (items: LineItem[]) => {
      const current = items.find((item) => item.productId === productId);
      if (current) {
        return items.map((item) => item.productId === productId ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...items, { productId, name: product.name, area: product.area, price: product.price, qty: 1 }];
    };

    if (target === "saleCart") {
      setSaleCart(apply);
      return;
    }

    mutate({
      ...state,
      tables: state.tables.map((table) => {
        if (table.id !== selectedTableId) return table;
        return { ...table, status: "preparacion", openedAt: table.openedAt ?? new Date().toISOString(), items: apply(table.items) };
      }),
    });
  }

  function changeQty(productId: string, delta: number, target: "saleCart" | "table") {
    if (saleInProgressRef.current) return;
    const apply = (items: LineItem[]) => {
      return items
        .map((item) => {
          if (item.productId !== productId) return item;
          const nextQty = Math.max(0, item.qty + delta);
          return { ...item, qty: nextQty };
        })
        .filter((item) => item.qty > 0);
    };

    if (target === "saleCart") {
      setSaleCart(apply);
      return;
    }

    mutate({
      ...state,
      tables: state.tables.map((table) => {
        if (table.id !== selectedTableId) return table;
        const items = apply(table.items);
        return { ...table, status: items.length ? table.status : "vacio", openedAt: items.length ? table.openedAt : undefined, items };
      }),
    });
  }

  async function finishUnifiedSale() {
    if (!saleCart.length || saleInProgressRef.current) return;
    if (!openCashSession) {
      window.alert("Primero tenes que abrir la caja.");
      return;
    }
    saleInProgressRef.current = true;
    const cart = saleCart;
    const customer = saleCustomer || "Consumidor final";
    const payment = salePayment;
    try {
      const latestState = await loadRemoteState();
      const latestOpenCash = currentOpenCashSession(latestState.cashSessions, latestState.settings.operationalCloseHour);
      if (!latestOpenCash || latestOpenCash.id !== openCashSession.id) {
        window.alert("La caja cambio en otra computadora. Se actualizaron los datos.");
        setState(latestState);
        return;
      }
      const saleAreas = uniqueSaleAreas(cart, latestState.products);
      const createdAt = new Date().toISOString();
      const unifiedTicket = nextUnifiedTicketNumber();
      const groupedSales = saleAreas.map((area) => {
        const items = cart.filter((item) => itemArea(item, latestState.products) === area);
        return {
          id: crypto.randomUUID(),
          ticketNumber: saleAreas.length > 1 ? `${unifiedTicket}-${area === "drugstore" ? "D" : "B"}` : unifiedTicket,
          createdAt,
          area,
          customer,
          payment,
          items,
          total: total(items),
          cashSessionId: latestOpenCash.id,
        } satisfies Sale;
      });
      const printedSale: Sale = {
        id: crypto.randomUUID(),
        ticketNumber: unifiedTicket,
        createdAt,
        area: saleAreas[0] ?? "bar",
        customer,
        payment,
        items: cart,
        total: total(cart),
        cashSessionId: latestOpenCash.id,
      };
      const nextState = {
        ...latestState,
        products: latestState.products.map((product) => {
          const item = cart.find((entry) => entry.productId === product.id);
          return item && product.area === "drugstore" ? { ...product, stock: product.stock - item.qty } : product;
        }),
        sales: [...latestState.sales, ...groupedSales],
      };
      await persistStateChanges(latestState, nextState);
      setState(nextState);
      setSyncError("");
      setSaleCart([]);
      setSaleCustomer("");
      setTimeout(() => printTicket(nextState.settings, printedSale), 50);
    } catch {
      window.alert("No se pudo guardar la venta. No se imprime el ticket para evitar diferencias en caja.");
      setSyncError("No se pudo guardar la venta.");
    } finally {
      setTimeout(() => { saleInProgressRef.current = false; }, 1200);
    }
  }

  async function closeTable() {
    if (!selectedTable?.items.length || saleInProgressRef.current) return;
    if (!openCashSession) {
      window.alert("Primero tenes que abrir la caja.");
      return;
    }
    saleInProgressRef.current = true;
    const payment = tablePayment;
    try {
      const latestState = await loadRemoteState();
      const latestOpenCash = currentOpenCashSession(latestState.cashSessions, latestState.settings.operationalCloseHour);
      if (!latestOpenCash || latestOpenCash.id !== openCashSession.id) {
        window.alert("La caja cambio en otra computadora. Se actualizaron los datos.");
        setState(latestState);
        return;
      }
      const table = latestState.tables.find((entry) => entry.id === selectedTable.id) ?? selectedTable;
      if (!table.items.length) {
        window.alert("La mesa ya no tiene articulos para cobrar.");
        setState(latestState);
        return;
      }
      const sale: Sale = {
        id: crypto.randomUUID(),
        ticketNumber: nextTicketNumber("bar"),
        createdAt: new Date().toISOString(),
        area: "bar",
        customer: table.name,
        payment,
        items: table.items,
        total: total(table.items),
        cashSessionId: latestOpenCash.id,
      };
      const nextState = {
        ...latestState,
        sales: [...latestState.sales, sale],
        tables: latestState.tables.map((entry) => entry.id === table.id ? { ...entry, status: "vacio" as const, openedAt: undefined, items: [] } : entry),
      };
      await persistStateChanges(latestState, nextState);
      setState(nextState);
      setSyncError("");
      setTablePayment("Efectivo");
      setTimeout(() => printTicket(nextState.settings, sale), 50);
    } catch {
      window.alert("No se pudo guardar el cobro de la mesa. No se imprime el ticket para evitar diferencias en caja.");
      setSyncError("No se pudo guardar el cobro de la mesa.");
    } finally {
      setTimeout(() => { saleInProgressRef.current = false; }, 1200);
    }
  }

  async function openCash(_area: Area, openingAmount: number) {
    if (openingAmount >= 500000 && !window.confirm(`Estas abriendo caja con ${money(openingAmount)} de efectivo inicial. Confirmar?`)) {
      return;
    }
    let latestState = state;
    try {
      latestState = await loadRemoteState();
    } catch {
      window.alert("No se pudo revisar el estado de caja. Intenta de nuevo.");
      return;
    }
    if (currentOpenCashSession(latestState.cashSessions, latestState.settings.operationalCloseHour)) {
      window.alert("Ya hay una caja abierta.");
      setState(latestState);
      return;
    }
    const cashSession: CashSession = {
      id: crypto.randomUUID(),
      area: "general",
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
    localCashChangeUntilRef.current = Date.now() + 5000;
    setCashOpeningAnimation(true);
    setState({ ...latestState, cashSessions: [...latestState.cashSessions, cashSession] });
    setView("dashboard");
    window.setTimeout(() => setCashOpeningAnimation(false), 2600);
  }

  async function addCashMovement(cashSession: CashSession, movement: Omit<CashMovement, "id" | "createdAt">) {
    const nextMovement: CashMovement = { ...movement, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    try {
      const latestState = await loadRemoteState();
      const latestCash = latestState.cashSessions.find((cash) => cash.id === cashSession.id);
      if (!latestCash || latestCash.status !== "abierta") {
        window.alert("Esa caja ya no esta abierta. Se actualizaron los datos.");
        setState(latestState);
        setMovementCash(null);
        return;
      }
      const nextState = {
        ...latestState,
        cashSessions: latestState.cashSessions.map((cash) => cash.id === cashSession.id ? { ...cash, movements: [...cash.movements, nextMovement] } : cash),
      };
      await persistStateChanges(latestState, nextState);
      setState(nextState);
      setSyncError("");
      setMovementCash(null);
    } catch {
      window.alert("No se pudo guardar el movimiento de caja.");
      setSyncError("No se pudo guardar el movimiento de caja.");
    }
  }

  async function updateCashOpeningAmount(cashSession: CashSession, openingAmount: number) {
    try {
      const latestState = await loadRemoteState();
      const latestCash = latestState.cashSessions.find((cash) => cash.id === cashSession.id);
      if (!latestCash || latestCash.status !== "abierta") {
        window.alert("Esa caja ya no esta abierta. Se actualizaron los datos.");
        setState(latestState);
        return;
      }
      const nextState = {
        ...latestState,
        cashSessions: latestState.cashSessions.map((cash) => cash.id === cashSession.id ? { ...cash, openingAmount } : cash),
      };
      await persistStateChanges(latestState, nextState);
      setState(nextState);
      setSyncError("");
    } catch {
      window.alert("No se pudo corregir el efectivo inicial.");
      setSyncError("No se pudo corregir el efectivo inicial.");
    }
  }

  async function closeCash(cashSession: CashSession, countedAmount?: number) {
    let latestState = state;
    try {
      latestState = await loadRemoteState();
    } catch {
      window.alert("No se pudo actualizar la caja antes del cierre. Revisa la conexion e intenta nuevamente.");
      return;
    }
    const latestCashSession = latestState.cashSessions.find((cash) => cash.id === cashSession.id);
    if (!latestCashSession || latestCashSession.status !== "abierta") {
      window.alert("Esta caja ya no esta abierta. Se actualizaron los datos.");
      setState(latestState);
      setClosingCash(null);
      return;
    }
    const expectedAmount = cashExpected(latestCashSession, latestState.sales);
    const closed: CashSession = {
      ...latestCashSession,
      status: "cerrada",
      closedAt: new Date().toISOString(),
      closedBy: session?.user.email ?? "Usuario",
      expectedAmount,
      ...(typeof countedAmount === "number" ? { countedAmount, difference: countedAmount - expectedAmount } : {}),
    };
    localCashChangeUntilRef.current = Date.now() + 5000;
    const { data: closedRows, error } = await supabase
      .from("cash_sessions")
      .update({ payload: closed, opened_at: closed.openedAt, closed_at: closed.closedAt, updated_at: closed.closedAt })
      .eq("id", closed.id)
      .is("closed_at", null)
      .select("id");
    if (error) {
      window.alert("No se pudo cerrar la caja. Intenta nuevamente.");
      return;
    }
    if (!closedRows?.length) {
      window.alert("Esta caja ya fue cerrada en otra computadora. Se actualizaron los datos.");
      setState(await loadRemoteState());
      setClosingCash(null);
      return;
    }
    setCashClosingAnimation(true);
    setState({ ...latestState, cashSessions: latestState.cashSessions.map((cash) => cash.id === closed.id ? closed : cash) });
    setClosingCash(null);
    printCashClose(latestState.settings, closed, latestState.sales);
    window.setTimeout(() => setCashClosingAnimation(false), 2600);
  }

  function setTableStatus(tableId: string, status: TableStatus) {
    mutate({
      ...state,
      tables: state.tables.map((table) => table.id === tableId ? { ...table, status, openedAt: status === "vacio" ? undefined : (table.openedAt ?? new Date().toISOString()) } : table),
    });
  }

  function deleteTable(tableId: string) {
    const table = state.tables.find((entry) => entry.id === tableId);
    if (!table) return;
    if (table.items.length) {
      window.alert(`${table.name} tiene un pedido activo. Primero cobra o vacia el pedido.`);
      return;
    }
    if (!window.confirm(`Seguro que queres eliminar ${table.name}? Esta accion no se puede deshacer.`)) return;
    const remaining = normalizeTables(state.tables.filter((entry) => entry.id !== tableId));
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
    const normalized = { ...product, barcodes, id: product.id || crypto.randomUUID(), category: product.area === "bar" ? normalizeMenuCategory(product) : "Stock", price: Number(product.price), stock: Number(product.stock), min: Number(product.min) };
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
    addLine(product.id, "saleCart");
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
    setSaleCart((items) => items.filter((item) => item.productId !== productId));
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
  if (cashClosingAnimation) return <CashClosingSplash />;
  if (cashOpeningAnimation) return <CashOpeningSplash />;
  if (!openCashSession) return <ShiftStartScreen cashLiveNotice={cashLiveNotice} onDismissNotice={() => setCashLiveNotice("")} pendingOpenCashSessions={pendingOpenCashSessions} sales={state.sales} onOpen={(amount) => openCash("drugstore", amount)} onCloseUnreviewed={closeCash} />;

  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.headerBrand}>
            <button className={styles.logoButton} onClick={() => setView("dashboard")} aria-label="Volver al inicio">
              <Image className={styles.brandLogo} src="/al-toque-logo.png" alt="Al toque" width={72} height={72} priority />
            </button>
            <div>
              <span>Bar · Cafeteria</span>
              <h1>{view === "dashboard" ? "Al toque" : title}</h1>
              <p>{view === "dashboard" ? "Elegí con qué módulo trabajar." : subtitle}</p>
            </div>
          </div>
          <div className={styles.topActions}>
            {view !== "dashboard" && <button className={`${styles.textButton} ${styles.homeButton}`} onClick={() => setView("dashboard")}>Inicio</button>}
            <button className={`${styles.textButton} ${view === "sales" ? styles.navActive : ""}`} onClick={() => setView("sales")}>Vender</button>
            <button className={`${styles.textButton} ${view === "tables" ? styles.navActive : ""}`} onClick={() => setView("tables")}>Mesas</button>
            <button className={`${styles.textButton} ${view === "items" ? styles.navActive : ""}`} onClick={() => setView("items")}>Articulos</button>
            <button className={`${styles.textButton} ${view === "cash" ? styles.navActive : ""}`} onClick={() => setView("cash")}>Caja</button>
            <button className={`${styles.textButton} ${view === "reports" ? styles.navActive : ""}`} onClick={() => setView("reports")}>Reportes</button>
            <button className={`${styles.textButton} ${view === "settings" ? styles.navActive : ""}`} onClick={() => setView("settings")}>Ajustes</button>
            <button className={styles.textButton} onClick={() => void supabase.auth.signOut()}>Salir</button>
          </div>
        </header>

        {syncError && <div className={styles.syncError}>{syncError}</div>}
        {cashLiveNotice && <CashLiveNotice text={cashLiveNotice} onDismiss={() => setCashLiveNotice("")} />}
        {cashNotice && <div className={`${styles.cashNotice} ${cashNotice.tone === "danger" ? styles.cashNoticeDanger : ""}`}><strong>{cashNotice.title}</strong><span>{cashNotice.text}</span></div>}

        {view === "dashboard" && (
          <DashboardView
            onNavigate={setView}
          />
        )}

        {view === "sales" && (
          <UnifiedSalesView
            saleFilter={saleFilter}
            setSaleFilter={setSaleFilter}
            openCashSession={openCashSession}
            products={filteredSaleProducts}
            saleSearch={saleSearch}
            setSaleSearch={setSaleSearch}
            barcodeInput={barcodeInput}
            barcodeMessage={barcodeMessage}
            barcodeInputRef={barcodeInputRef}
            handleBarcodeInput={handleBarcodeInput}
            scanBarcode={scanBarcode}
            onOpenCash={openCash}
            onPick={(id) => addLine(id, "saleCart")}
            cart={saleCart}
            customer={saleCustomer}
            payment={salePayment}
            cartSum={saleCartSum}
            setCart={setSaleCart}
            setCustomer={setSaleCustomer}
            setPayment={setSalePayment}
            onQty={(id, delta) => changeQty(id, delta, "saleCart")}
            onFinish={finishUnifiedSale}
          />
        )}

        {view === "tables" && (
          <TablesView
            openCashSession={openCashSession}
            state={state}
            selectedTable={selectedTable}
            selectedTableId={selectedTableId}
            setSelectedTableId={setSelectedTableId}
            tableStatusFilter={tableStatusFilter}
            setTableStatusFilter={setTableStatusFilter}
            filteredMenu={filteredMenu}
            tableMenuFilter={tableMenuFilter}
            setTableMenuFilter={setTableMenuFilter}
            barSearch={barSearch}
            setBarSearch={setBarSearch}
            tablePayment={tablePayment}
            setTablePayment={setTablePayment}
            tableSum={tableSum}
            onOpenCash={(amount) => openCash("bar", amount)}
            onAddTable={() => {
              if (state.tables.length >= MAX_TABLES) return;
              const table = { id: crypto.randomUUID(), name: nextTableName(state.tables), status: "vacio" as TableStatus, items: [] };
              mutate({ ...state, tables: [...state.tables, table].sort(compareTables) });
              setSelectedTableId(table.id);
            }}
            onDeleteTable={deleteTable}
            onPick={(id) => addLine(id, "table")}
            onStatus={setTableStatus}
            onQty={(id, delta) => changeQty(id, delta, "table")}
            onCloseTable={closeTable}
          />
        )}

        {view === "items" && (
          <ItemsView
            itemsArea={itemsArea}
            setItemsArea={setItemsArea}
            drugstoreProducts={drugstoreProducts}
            barProducts={barProducts}
            lowDrugstoreStock={lowDrugstoreStock}
            setEditingProduct={setEditingProduct}
            deleteProduct={deleteProduct}
            setStockProduct={setStockProduct}
            setBarcodeProduct={setBarcodeProduct}
          />
        )}

        {view === "cash" && (
          <CashCenter
            openCashSession={openCashSession}
            pendingOpenCashSessions={pendingOpenCashSessions}
            sales={state.sales}
            closeHour={state.settings.operationalCloseHour}
            onOpenCash={openCash}
            onMovement={setMovementCash}
            onClose={setClosingCash}
            onCloseUnreviewed={closeCash}
            onUpdateOpeningAmount={updateCashOpeningAmount}
          />
        )}

        {view === "reports" && (
          <ReportsView
            reportDate={reportDate}
            setReportDate={setReportDate}
            selectedDaySales={selectedDaySales}
            selectedDayDrugstoreSales={selectedDayDrugstoreSales}
            selectedDayBarSales={selectedDayBarSales}
            currentSales={currentSales}
            openCashSales={openCashSales}
            currentDrugstoreSales={currentDrugstoreSales}
            currentBarSales={currentBarSales}
            openCashSession={openCashSession}
            state={state}
          />
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
      {closingCash && <CashCloseModal cashSession={closingCash} sales={state.sales} closeHour={state.settings.operationalCloseHour} onCancel={() => setClosingCash(null)} onClose={(countedAmount) => closeCash(closingCash, countedAmount)} />}
    </div>
  );
}

function DashboardView({ onNavigate }: { onNavigate: (view: View) => void }) {
  return (
    <div className={styles.homePage}>
      <section className={styles.homeHero}>
        <div>
          <span>Al toque</span>
          <h2>Panel principal</h2>
        </div>
        <button className={styles.heroAction} onClick={() => onNavigate("sales")}>Ir a vender</button>
      </section>

      <section className={styles.homeMenu}>
        <button className={`${styles.homePrimaryAction} ${styles.salesHomeAction}`} onClick={() => onNavigate("sales")}><Image className={styles.homeIllustration} src="/home-illustrations/vender.png" width={260} height={260} alt="" /><strong>Vender</strong><small>Aqui puedes vender los articulos</small></button>
        <button className={`${styles.homePrimaryAction} ${styles.tablesHomeAction}`} onClick={() => onNavigate("tables")}><Image className={styles.homeIllustration} src="/home-illustrations/mesas.png" width={260} height={260} alt="" /><strong>Mesas</strong><small>Pedidos del salon</small></button>
        <div className={styles.homeSideActions}>
          <TaskButton image="/home-illustrations/articulos.png" title="Articulos" text="Stock y menu" onClick={() => onNavigate("items")} tone="blue" />
          <TaskButton image="/home-illustrations/caja.png" title="Caja" text="Turno actual" onClick={() => onNavigate("cash")} tone="red" />
          <TaskButton image="/home-illustrations/reportes.png" title="Reportes" text="Control" onClick={() => onNavigate("reports")} tone="plain" />
        </div>
      </section>
    </div>
  );
}

function TaskButton({ image, title, text, tone, onClick }: { image: string; title: string; text: string; tone: "gold" | "green" | "blue" | "red" | "plain"; onClick: () => void }) {
  return <button className={`${styles.taskButton} ${styles[`${tone}Task`]}`} onClick={onClick}><Image className={styles.taskIllustration} src={image} width={92} height={92} alt="" /><strong>{title}</strong><span>{text}</span></button>;
}

function UnifiedSalesView({
  saleFilter,
  setSaleFilter,
  openCashSession,
  products,
  saleSearch,
  setSaleSearch,
  barcodeInput,
  barcodeMessage,
  barcodeInputRef,
  handleBarcodeInput,
  scanBarcode,
  onOpenCash,
  onPick,
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
  saleFilter: SaleFilter;
  setSaleFilter: (filter: SaleFilter) => void;
  openCashSession?: CashSession;
  products: Product[];
  saleSearch: string;
  setSaleSearch: (value: string) => void;
  barcodeInput: string;
  barcodeMessage: string;
  barcodeInputRef: React.RefObject<HTMLInputElement | null>;
  handleBarcodeInput: (value: string) => void;
  scanBarcode: () => void;
  onOpenCash: (area: Area, amount: number) => void | Promise<void>;
  onPick: (id: string) => void;
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
    <div className={styles.unifiedPage}>
      <section className={styles.sectionHero}>
        <div><span>Mostrador</span><h2>Venta unificada</h2></div>
        <SegmentedControl options={[["all", "Todos"], ["drugstore", "Drugstore"], ["bar", "Bar"]]} value={saleFilter} onChange={(value) => setSaleFilter(value as SaleFilter)} tone={saleFilter === "bar" ? "bar" : "drugstore"} />
      </section>
      <div className={styles.saleCashWarnings}>
        {!openCashSession && <InlineCashOpen area="drugstore" onOpen={onOpenCash} />}
      </div>
      {!openCashSession && cart.length > 0 && <div className={styles.syncError}>Para cobrar este ticket primero hay que abrir caja.</div>}
      <div className={styles.unifiedSaleLayout}>
        <Panel title="Productos del local" variant="catalog">
          <form className={styles.barcodeScanner} onSubmit={(event) => { event.preventDefault(); scanBarcode(); }}>
            <label>Codigo de barras<input ref={barcodeInputRef} autoFocus autoComplete="off" inputMode="numeric" value={barcodeInput} onChange={(event) => handleBarcodeInput(event.target.value)} placeholder="Escanear o escribir codigo" /></label>
            <button className={styles.scanButton}>Agregar</button>
          </form>
          {barcodeMessage && <p className={styles.barcodeMessage}>{barcodeMessage}</p>}
          <div className={styles.catalogDivider}><span>Buscar manualmente</span></div>
          <input type="search" placeholder="Buscar producto o item del menu..." value={saleSearch} onChange={(event) => setSaleSearch(event.target.value)} />
          <ProductGrid products={products} onPick={onPick} showStock hideCategory />
        </Panel>
        <SaleTicket cart={cart} customer={customer} payment={payment} cartSum={cartSum} setCart={setCart} setCustomer={setCustomer} setPayment={setPayment} onQty={onQty} onFinish={onFinish} />
      </div>
    </div>
  );
}

function InlineCashOpen({ area, onOpen }: { area: Area; onOpen: (area: Area, amount: number) => void | Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  return <form className={styles.inlineCashOpen} onSubmit={async (event) => { event.preventDefault(); setLoading(true); await onOpen(area, Number(amount || 0)); setLoading(false); }}><span>Caja cerrada</span><label>Efectivo inicial<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="$ 0" /></label><button className={styles.primaryCompact} disabled={loading}>{loading ? "Abriendo..." : "Abrir caja"}</button></form>;
}

function TablesView({
  openCashSession,
  state,
  selectedTable,
  selectedTableId,
  setSelectedTableId,
  tableStatusFilter,
  setTableStatusFilter,
  filteredMenu,
  tableMenuFilter,
  setTableMenuFilter,
  barSearch,
  setBarSearch,
  tablePayment,
  setTablePayment,
  tableSum,
  onOpenCash,
  onAddTable,
  onDeleteTable,
  onPick,
  onStatus,
  onQty,
  onCloseTable,
}: {
  openCashSession?: CashSession;
  state: AppState;
  selectedTable?: TableOrder;
  selectedTableId: string;
  setSelectedTableId: (id: string) => void;
  tableStatusFilter: TableFilter;
  setTableStatusFilter: (filter: TableFilter) => void;
  filteredMenu: Product[];
  tableMenuFilter: MenuFilter;
  setTableMenuFilter: (filter: MenuFilter) => void;
  barSearch: string;
  setBarSearch: (value: string) => void;
  tablePayment: string;
  setTablePayment: (value: string) => void;
  tableSum: number;
  onOpenCash: (amount: number) => void | Promise<void>;
  onAddTable: () => void;
  onDeleteTable: (id: string) => void;
  onPick: (id: string) => void;
  onStatus: (id: string, status: TableStatus) => void;
  onQty: (id: string, delta: number) => void;
  onCloseTable: () => void;
}) {
  const preparingTables = state.tables.filter((table) => table.status === "preparacion");
  const deliveredTables = state.tables.filter((table) => table.status === "entregado");
  const emptyTables = state.tables.filter((table) => !table.items.length);
  const visibleTables = tableStatusFilter === "todas" ? state.tables : state.tables.filter((table) => table.status === tableStatusFilter);

  return (
    <div className={styles.tablesFullscreen}>
      {!openCashSession && <div className={styles.floatingCashOpen}><InlineCashOpen area="bar" onOpen={(_area, amount) => onOpenCash(amount)} /></div>}
      <div className={`${styles.restaurantWorkspace} ${selectedTable ? styles.detailOpen : ""}`}>
        <section className={styles.floorPanel}>
          <div className={styles.floorHeader}>
            <div><span>Salon</span><h3>Mesas</h3></div>
            <div className={styles.floorStats}>
              <button className={tableStatusFilter === "todas" ? styles.statActive : ""} onClick={() => setTableStatusFilter("todas")}>Todas {state.tables.length}</button>
              <button className={tableStatusFilter === "preparacion" ? styles.statActive : ""} onClick={() => setTableStatusFilter("preparacion")}>Pendientes {preparingTables.length}</button>
              <button className={tableStatusFilter === "entregado" ? styles.statActive : ""} onClick={() => setTableStatusFilter("entregado")}>Entregadas {deliveredTables.length}</button>
              <button className={tableStatusFilter === "vacio" ? styles.statActive : ""} onClick={() => setTableStatusFilter("vacio")}>Vacias {emptyTables.length}</button>
            </div>
            <button className={styles.primaryCompact} disabled={state.tables.length >= MAX_TABLES} onClick={onAddTable}>Nueva mesa</button>
          </div>
          <div className={styles.floorBoard}>
            <div className={styles.floorAreaLabel}>Plano general</div>
            <div className={styles.tableGrid}>
            {visibleTables.map((table) => (
              <button key={table.id} className={`${styles.tableCard} ${tableStatusCardClass(table.status)} ${selectedTableId === table.id ? styles.selected : ""}`} onClick={() => setSelectedTableId(table.id)}>
                <span className={styles.tableIllustration}>
                  <span className={styles.tableChairBack} />
                  <span className={styles.tableChairLeft} />
                  <span className={styles.tableChairRight} />
                  <span className={styles.tableTop} />
                  <span className={styles.tableBase} />
                  <span className={styles.tableShadow} />
                </span>
                <strong>{table.name}</strong>
                <span className={styles.tableMeta}>{table.items.length} items</span>
                <span className={`${styles.statusPill} ${statusClass(table.status)}`}>{statusLabel(table.status)}</span>
              </button>
            ))}
            {!visibleTables.length && <div className={styles.emptyMini}>No hay mesas con este estado.</div>}
            </div>
          </div>
          <div className={styles.floorLegend}>
            <span><i className={styles.legendEmpty} /> Vacia</span>
            <span><i className={styles.legendPreparing} /> En preparacion</span>
            <span><i className={styles.legendDelivered} /> Entregada</span>
          </div>
        </section>
        {selectedTable && <aside className={styles.tableDetailDrawer}>
          <section className={styles.tableDetailCard}>
            <div className={styles.detailHeader}><div><span>Detalle</span><h3>{selectedTable.name}</h3></div><button className={styles.closeDrawerButton} onClick={() => setSelectedTableId("")}>Cerrar</button></div>
            <div className={styles.tableInfoGrid}>
              <div><span>Apertura</span><strong>{selectedTable.openedAt ? timeOnly(selectedTable.openedAt) : "-"}</strong></div>
              <div><span>Ocupada</span><strong>{selectedTable.openedAt ? durationSince(selectedTable.openedAt) : "-"}</strong></div>
              <div><span>Items</span><strong>{selectedTable.items.length}</strong></div>
              <div><span>Total</span><strong>{money(tableSum)}</strong></div>
            </div>
            <div className={styles.statusActions}>
              <button disabled={Boolean(selectedTable.items.length)} className={`${styles.emptyStatusButton} ${selectedTable.status === "vacio" ? styles.statusActive : ""}`} onClick={() => onStatus(selectedTable.id, "vacio")}>Vacio</button>
              <button disabled={!selectedTable.items.length} className={`${styles.preparingStatusButton} ${selectedTable.status === "preparacion" ? styles.statusActive : ""}`} onClick={() => onStatus(selectedTable.id, "preparacion")}>En preparacion</button>
              <button disabled={!selectedTable.items.length} className={`${styles.deliveredStatusButton} ${selectedTable.status === "entregado" ? styles.statusActive : ""}`} onClick={() => onStatus(selectedTable.id, "entregado")}>Entregado</button>
            </div>
            <div className={styles.tablePayRow}><label>Pago<select value={tablePayment} onChange={(event) => setTablePayment(event.target.value)}><option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option><option>Cuenta corriente</option></select></label><button className={styles.primaryButton} onClick={onCloseTable}>Cobrar mesa</button></div>
          </section>
          <section className={styles.quickMenuPanel}>
            <div className={styles.quickPanelHeader}><strong>Agregar al pedido</strong><span>{filteredMenu.length} articulos</span></div>
            <div className={styles.quickCategoryBar}>{menuCategories.filter((category) => category !== "Todos").map((category) => <button key={category} className={tableMenuFilter === category ? styles.quickCategoryActive : ""} onClick={() => setTableMenuFilter(category)}>{category}</button>)}</div>
            <input type="search" placeholder="Buscar en menu..." value={barSearch} onChange={(event) => setBarSearch(event.target.value)} />
            <ProductGrid products={filteredMenu} onPick={onPick} compact hideCategory />
          </section>
          <section className={styles.tableOrderPanel}>
            <div className={styles.tableOrderHeader}><div><strong>Pedido actual</strong><small>{selectedTable.items.length} items cargados</small></div><span>{money(tableSum)}</span></div>
            <Cart items={selectedTable.items} onQty={onQty} />
            <div className={styles.tableDangerZone}><span>{selectedTable.items.length ? "No se puede eliminar con pedido." : "Eliminar pide confirmacion."}</span><button className={styles.deleteTableButton} disabled={Boolean(selectedTable.items.length)} onClick={() => onDeleteTable(selectedTable.id)}>Eliminar mesa</button></div>
          </section>
        </aside>}
      </div>
    </div>
  );
}

function ItemsView({ itemsArea, setItemsArea, drugstoreProducts, barProducts, lowDrugstoreStock, setEditingProduct, deleteProduct, setStockProduct, setBarcodeProduct }: { itemsArea: Area; setItemsArea: (area: Area) => void; drugstoreProducts: Product[]; barProducts: Product[]; lowDrugstoreStock: Product[]; setEditingProduct: (product: Product) => void; deleteProduct: (productId: string) => void; setStockProduct: (product: Product) => void; setBarcodeProduct: (product: Product) => void }) {
  const isDrugstore = itemsArea === "drugstore";
  return (
    <div className={styles.unifiedPage}>
      <section className={styles.sectionHero}>
        <div><span>Catalogo</span><h2>Articulos</h2></div>
        <SegmentedControl options={[["drugstore", "Stock Drugstore"], ["bar", "Menu Bar"]]} value={itemsArea} onChange={(value) => setItemsArea(value as Area)} tone={itemsArea} />
      </section>
      <div className={styles.inventoryLayout}>
        <ProductTable
          title={isDrugstore ? "Stock del drugstore" : "Menu del bar"}
          products={isDrugstore ? drugstoreProducts : barProducts}
          onAdd={() => setEditingProduct({ ...blankProduct, area: itemsArea })}
          onEdit={setEditingProduct}
          onDelete={deleteProduct}
          onAddStock={isDrugstore ? setStockProduct : undefined}
          onViewBarcodes={isDrugstore ? setBarcodeProduct : undefined}
          menuOnly={!isDrugstore}
          variant="inventory"
          hideCategory={isDrugstore}
          pageSize={20}
        />
        {isDrugstore && lowDrugstoreStock.length > 0 && (
          <Panel title="Necesitan reposicion" variant="alert">
            {lowDrugstoreStock.map((product) => <ListItem key={product.id} title={product.name} meta={`Quedan ${product.stock}. Minimo sugerido: ${product.min}`} />)}
          </Panel>
        )}
      </div>
    </div>
  );
}

function CashCenter({ openCashSession, pendingOpenCashSessions, sales, closeHour, onOpenCash, onMovement, onClose, onCloseUnreviewed, onUpdateOpeningAmount }: { openCashSession?: CashSession; pendingOpenCashSessions: CashSession[]; sales: Sale[]; closeHour: string; onOpenCash: (area: Area, amount: number) => void | Promise<void>; onMovement: (cash: CashSession) => void; onClose: (cash: CashSession) => void; onCloseUnreviewed: (cash: CashSession) => void | Promise<void>; onUpdateOpeningAmount: (cash: CashSession, amount: number) => void | Promise<void> }) {
  return (
    <div className={styles.unifiedPage}>
      <section className={styles.sectionHero}>
        <div><span>Caja</span><h2>Caja del local</h2></div>
        <div className={styles.sectionStats}><span>{openCashSession ? "Caja abierta" : "Caja cerrada"}</span></div>
      </section>
      <div className={styles.cashCenterGrid}>
        <div>{openCashSession ? <CashBar cashSession={openCashSession} sales={sales} closeHour={closeHour} onMovement={() => onMovement(openCashSession)} onClose={() => onClose(openCashSession)} onUpdateOpeningAmount={(amount) => onUpdateOpeningAmount(openCashSession, amount)} /> : <CashOpen area="drugstore" onOpen={(amount) => onOpenCash("drugstore", amount)} />}</div>
      </div>
      {pendingOpenCashSessions.length > 0 && <PendingCashSessions cashSessions={pendingOpenCashSessions} sales={sales} onCloseUnreviewed={onCloseUnreviewed} />}
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

function ShiftStartScreen({ cashLiveNotice, onDismissNotice, pendingOpenCashSessions = [], sales = [], onOpen, onCloseUnreviewed }: { cashLiveNotice?: string; onDismissNotice?: () => void; pendingOpenCashSessions?: CashSession[]; sales?: Sale[]; onOpen: (amount: number) => void | Promise<void>; onCloseUnreviewed?: (cash: CashSession) => void | Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <main className={styles.shiftStartPage}>
      {cashLiveNotice && onDismissNotice && <CashLiveNotice text={cashLiveNotice} onDismiss={onDismissNotice} />}
      <section className={styles.shiftStartCard}>
        <div className={styles.shiftLogoFrame}>
          <Image className={styles.shiftLogo} src="/al-toque-logo.png" alt="Al toque" width={160} height={160} priority />
        </div>
        <div className={styles.shiftStartCopy}>
          <span>Caja cerrada</span>
          <h1>Al toque</h1>
          <p>Abri la caja para iniciar ventas, mesas y cierre del turno.</p>
        </div>
        <form className={styles.shiftStartForm} onSubmit={async (event) => { event.preventDefault(); setLoading(true); await onOpen(Number(amount || 0)); setLoading(false); }}>
          <label>Efectivo inicial<input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="$ 0" /></label>
          <button className={styles.shiftOpenButton} disabled={loading}>{loading ? "Abriendo caja..." : "Abrir caja"}</button>
        </form>
        {pendingOpenCashSessions.length > 0 && onCloseUnreviewed && (
          <div className={styles.shiftPendingCash}>
            <strong>Cajas viejas pendientes</strong>
            {pendingOpenCashSessions.map((cash) => {
              const sessionSales = sales.filter((sale) => sale.cashSessionId === cash.id);
              return <button key={cash.id} type="button" onClick={() => { if (window.confirm("Cerrar esta caja vieja como sin revisar?")) void onCloseUnreviewed(cash); }}>{date(cash.openedAt)} - {money(salesTotal(sessionSales))} - Cerrar sin revisar</button>;
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function CashLiveNotice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return <div className={styles.cashLiveNotice}><strong>Caja actualizada</strong><span>{text}</span><button type="button" onClick={onDismiss}>Cerrar</button></div>;
}

function CashOpeningSplash() {
  return (
    <main className={styles.cashOpeningSplash}>
      <div className={styles.openingLogoRing}>
        <Image className={styles.openingLogo} src="/al-toque-logo.png" alt="Al toque" width={178} height={178} priority />
      </div>
      <span>Iniciando caja</span>
    </main>
  );
}

function CashClosingSplash() {
  return (
    <main className={`${styles.cashOpeningSplash} ${styles.cashClosingSplash}`}>
      <div className={styles.closingLogoRing}>
        <Image className={styles.openingLogo} src="/al-toque-logo.png" alt="Al toque" width={178} height={178} priority />
      </div>
      <span>Caja cerrada</span>
    </main>
  );
}

function CashOpen({ area, onOpen, onManage }: { area: Area; onOpen: (amount: number) => void | Promise<void>; onManage?: () => void }) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  return <section className={styles.cashOpen}><div><span>Caja cerrada</span><h2>Abrir caja</h2><p>Ingresa el efectivo disponible al comenzar este turno.</p></div><form onSubmit={async (event) => { event.preventDefault(); setLoading(true); await onOpen(Number(amount || 0)); setLoading(false); }}><label>Efectivo inicial<input autoFocus type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="$ 0" /></label><button className={styles.primaryButton} disabled={loading}>{loading ? "Abriendo..." : "Abrir caja"}</button>{onManage && <><div className={styles.cashOpenDivider}><span>o continuar sin vender</span></div><button type="button" className={styles.manageOnlyButton} onClick={onManage}>{area === "drugstore" ? "Control de stock" : "Gestionar menu"}</button></>}</form></section>;
}

function CashBar({ cashSession, sales, closeHour, onMovement, onClose, onUpdateOpeningAmount }: { cashSession: CashSession; sales: Sale[]; closeHour: string; onMovement: () => void; onClose: () => void; onUpdateOpeningAmount: (amount: number) => void | Promise<void> }) {
  const sessionSales = sales.filter((sale) => sale.cashSessionId === cashSession.id);
  const spansBusinessDay = cashSpansBusinessDays(cashSession, closeHour);
  return <section className={styles.cashBar}><div><span>Caja abierta</span><strong>Caja unica</strong><small>Desde {date(cashSession.openedAt)} - {cashSession.openedBy}</small></div><div className={styles.cashBarMetrics}><div><span>Total desde apertura</span><strong>{money(sessionSales.reduce((sum, sale) => sum + sale.total, 0))}</strong></div><div><span>Efectivo esperado</span><strong>{money(cashExpected(cashSession, sales))}</strong></div></div><div className={styles.cashBarActions}><button className={styles.smallButton} onClick={onMovement}>Registrar movimiento</button><button className={styles.smallButton} onClick={() => { const value = window.prompt("Efectivo inicial correcto", String(cashSession.openingAmount)); if (value === null) return; const amount = Number(value); if (Number.isNaN(amount) || amount < 0) { window.alert("Ingresa un importe valido."); return; } void onUpdateOpeningAmount(amount); }}>Corregir inicial</button><button className={styles.closeCashButton} onClick={onClose}>Cerrar caja</button></div>{spansBusinessDay && <div className={styles.cashBarWarning}>Esta caja cruza jornadas. El efectivo esperado incluye todo desde la apertura.</div>}{cashSession.openingAmount >= 500000 && <div className={styles.cashBarWarning}>El efectivo inicial cargado es muy alto: {money(cashSession.openingAmount)}. Si fue un error, usa Corregir inicial.</div>}</section>;
}

function PendingCashSessions({ cashSessions, sales, onCloseUnreviewed }: { cashSessions: CashSession[]; sales: Sale[]; onCloseUnreviewed: (cash: CashSession) => void | Promise<void> }) {
  return (
    <Panel title={`Cajas abiertas pendientes (${cashSessions.length})`} variant="alert">
      <div className={styles.pendingCashList}>
        {cashSessions.map((cash) => {
          const sessionSales = sales.filter((sale) => sale.cashSessionId === cash.id);
          return (
            <div className={styles.pendingCashItem} key={cash.id}>
              <div><strong>{date(cash.openedAt)}</strong><span>{sessionSales.length} tickets - {money(salesTotal(sessionSales))}</span></div>
              <button className={styles.closeCashButton} onClick={() => { if (window.confirm("Cerrar esta caja vieja como sin revisar?")) void onCloseUnreviewed(cash); }}>Cerrar sin revisar</button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function CashMovementModal({ onCancel, onSave }: { cashSession: CashSession; onCancel: () => void; onSave: (movement: Omit<CashMovement, "id" | "createdAt">) => void | Promise<void> }) {
  const [type, setType] = useState<CashMovement["type"]>("gasto");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  return <div className={styles.modalBackdrop}><form className={styles.modal} onSubmit={async (event) => { event.preventDefault(); setLoading(true); await onSave({ type, amount: Number(amount), reason }); setLoading(false); }}><h2>Movimiento de caja</h2><div className={styles.stockSummary}><strong>Caja unica</strong><span>Caja abierta</span></div><label>Tipo<select value={type} onChange={(event) => setType(event.target.value as CashMovement["type"])}><option value="ingreso">Ingreso de efectivo</option><option value="gasto">Gasto</option><option value="retiro">Retiro de efectivo</option></select></label><label>Importe<input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Motivo<input required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej: pago a proveedor" /></label><div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.primaryCompact} disabled={loading}>{loading ? "Guardando..." : "Guardar movimiento"}</button></div></form></div>;
}

function CashCloseModal({ cashSession, sales, closeHour, onCancel, onClose }: { cashSession: CashSession; sales: Sale[]; closeHour: string; onCancel: () => void; onClose: (countedAmount: number) => void | Promise<void> }) {
  const [counted, setCounted] = useState("");
  const [loading, setLoading] = useState(false);
  const expected = cashExpected(cashSession, sales);
  const difference = counted === "" ? null : Number(counted) - expected;
  const sessionSales = sales.filter((sale) => sale.cashSessionId === cashSession.id);
  return <div className={styles.modalBackdrop}><form className={`${styles.modal} ${styles.cashCloseModal}`} onSubmit={async (event) => { event.preventDefault(); setLoading(true); await onClose(Number(counted)); setLoading(false); }}><h2>Cerrar caja</h2>{cashSpansBusinessDays(cashSession, closeHour) && <div className={styles.cashCloseWarning}>Esta caja quedo abierta de una jornada anterior. El cierre incluye todo lo vendido desde {date(cashSession.openedAt)}.</div>}<div className={styles.cashCloseSummary}><Total label="Total desde apertura" value={sessionSales.reduce((sum, sale) => sum + sale.total, 0)} /><Total label="Efectivo inicial" value={cashSession.openingAmount} /><Total label="Ventas en efectivo" value={paymentTotal(sessionSales, "Efectivo")} /><Total label="Transferencias" value={paymentTotal(sessionSales, "Transferencia")} /><Total label="Tarjetas" value={paymentTotal(sessionSales, "Tarjeta")} /><Total label="Cuenta corriente" value={paymentTotal(sessionSales, "Cuenta corriente")} /><Total label="Ingresos" value={movementTotal(cashSession, "ingreso")} /><Total label="Gastos" value={movementTotal(cashSession, "gasto")} /><Total label="Retiros" value={movementTotal(cashSession, "retiro")} /><div className={styles.expectedCash}><span>Efectivo esperado</span><strong>{money(expected)}</strong></div></div><label>Efectivo contado<input autoFocus required type="number" min="0" step="0.01" value={counted} onChange={(event) => setCounted(event.target.value)} /></label>{difference !== null && <div className={`${styles.cashDifference} ${difference === 0 ? styles.exactCash : difference < 0 ? styles.missingCash : styles.extraCash}`}><span>Diferencia</span><strong>{money(difference)}</strong></div>}<div className={styles.modalActions}><button type="button" className={styles.smallButton} onClick={onCancel}>Cancelar</button><button className={styles.closeCashButton} disabled={loading}>{loading ? "Cerrando..." : "Confirmar cierre"}</button></div></form></div>;
}

function ReportsView({
  reportDate,
  setReportDate,
  selectedDaySales,
  selectedDayDrugstoreSales,
  selectedDayBarSales,
  currentSales,
  openCashSales,
  currentDrugstoreSales,
  currentBarSales,
  openCashSession,
  state,
}: {
  reportDate: string;
  setReportDate: (value: string) => void;
  selectedDaySales: Sale[];
  selectedDayDrugstoreSales: Sale[];
  selectedDayBarSales: Sale[];
  currentSales: Sale[];
  openCashSales: Sale[];
  currentDrugstoreSales: Sale[];
  currentBarSales: Sale[];
  openCashSession?: CashSession;
  state: AppState;
}) {
  const dayTotal = salesTotal(selectedDaySales);
  const dayCash = paymentTotal(selectedDaySales, "Efectivo");

  return (
    <div className={styles.reportsPage}>
      <section className={styles.reportsHero}>
        <div>
          <span>Control</span>
          <h2>Reportes</h2>
        </div>
        <label>Jornada a revisar<input type="date" value={reportDate} max={businessDateKey(new Date(), state.settings.operationalCloseHour)} onChange={(event) => setReportDate(event.target.value)} /></label>
      </section>

      <div className={styles.reportMetricGrid}>
        <ReportMetric label="Vendido en la jornada" value={money(dayTotal)} meta={`${selectedDaySales.length} tickets`} tone="money" />
        <ReportMetric label="Efectivo vendido" value={money(dayCash)} meta="Solo ventas en efectivo" tone="cash" />
        <ReportMetric label="Drugstore" value={money(salesTotal(selectedDayDrugstoreSales))} meta={`${selectedDayDrugstoreSales.length} tickets`} />
        <ReportMetric label="Bar" value={money(salesTotal(selectedDayBarSales))} meta={`${selectedDayBarSales.length} tickets`} />
        <ReportMetric label="Caja" value={openCashSession ? "Abierta" : "Cerrada"} meta="Unica para todo el local" tone={openCashSession ? "cash" : "muted"} />
      </div>

      <section className={styles.reportBlock}>
        <div className={styles.reportSectionHeader}><div><span>Corte {state.settings.operationalCloseHour}</span><h2>Que se vendio</h2></div><strong>{money(dayTotal)}</strong></div>
        <div className={styles.dailySalesGrid}>
          <Panel title="Drugstore"><DailyItems sales={selectedDayDrugstoreSales} /></Panel>
          <Panel title="Bar"><DailyItems sales={selectedDayBarSales} /></Panel>
        </div>
      </section>

      <div className={styles.reportInsightGrid}>
        <Panel title="Ventas por area"><AreaReport sales={selectedDaySales} /></Panel>
        <Panel title="Metodos de pago"><PaymentReport sales={selectedDaySales} /></Panel>
        <Panel title="Mas vendidos"><TopItems sales={selectedDaySales} /></Panel>
      </div>

      <section className={styles.reportBlock}>
        <div className={styles.reportSectionHeader}><div><span>Turno actual</span><h2>Estado de caja</h2></div></div>
        <div className={styles.cashSummaryGrid}>
          <CashSummaryCard cashSession={openCashSession} sales={openCashSales} businessSales={currentSales} />
        </div>
      </section>

      <section className={styles.reportBlock}>
        <div className={styles.reportSectionHeader}><div><span>Facturacion actual</span><h2>Tickets del turno actual</h2></div></div>
        <div className={styles.reportsBillingGrid}>
          <SalesTable title="Drugstore" sales={currentDrugstoreSales} settings={state.settings} />
          <SalesTable title="Bar" sales={currentBarSales} settings={state.settings} />
        </div>
      </section>

      <CashHistory cashSessions={state.cashSessions} sales={state.sales} settings={state.settings} />
    </div>
  );
}

function ReportMetric({ label, value, meta, tone }: { label: string; value: string; meta: string; tone?: "money" | "cash" | "muted" }) {
  const toneClass = tone ? styles[`${tone}Metric`] : "";
  return <div className={`${styles.reportMetric} ${toneClass}`}><span>{label}</span><strong>{value}</strong><small>{meta}</small></div>;
}

function CashSummaryCard({ cashSession, sales, businessSales }: { cashSession?: CashSession; sales: Sale[]; businessSales: Sale[] }) {
  if (!cashSession) return <div className={`${styles.cashSummaryCard} ${styles.closedCashSummary}`}><span>Caja unica</span><strong>Caja cerrada</strong><small>No hay ventas activas en este turno.</small></div>;
  return <div className={styles.cashSummaryCard}><div><span>Caja unica</span><strong>Abierta</strong><small>Desde {date(cashSession.openedAt)}</small></div><div className={styles.cashSummaryRows}><Total label="Vendido en jornada" value={salesTotal(businessSales)} /><Total label="Total desde apertura" value={salesTotal(sales)} /><Total label="Efectivo esperado" value={cashExpected(cashSession, sales)} /></div></div>;
}

function PaymentReport({ sales }: { sales: Sale[] }) {
  const payments = ["Efectivo", "Transferencia", "Tarjeta", "Cuenta corriente"];
  const max = Math.max(1, ...payments.map((payment) => paymentTotal(sales, payment)));
  if (!sales.length) return <div className={styles.empty}>No hay ventas en esta fecha.</div>;
  return <div className={styles.paymentBars}>{payments.map((payment) => {
    const value = paymentTotal(sales, payment);
    return <div className={styles.paymentLine} key={payment}><header><strong>{payment}</strong><span>{money(value)}</span></header><div className={styles.paymentTrack}><div style={{ width: `${(value / max) * 100}%` }} /></div></div>;
  })}</div>;
}

function CashHistory({ cashSessions, sales, settings }: { cashSessions: CashSession[]; sales: Sale[]; settings: AppState["settings"] }) {
  const [closeDate, setCloseDate] = useState("");
  const [selectedCashId, setSelectedCashId] = useState("");
  const [page, setPage] = useState(1);
  const closed = cashSessions.filter((cash) => cash.status === "cerrada").sort((a, b) => new Date(b.closedAt ?? 0).getTime() - new Date(a.closedAt ?? 0).getTime());
  const filtered = closeDate ? closed.filter((cash) => cash.closedAt && businessDateKey(new Date(cash.closedAt), settings.operationalCloseHour) === closeDate) : closed;
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, totalPages);
  const visibleCashSessions = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const selectedCash = closed.find((cash) => cash.id === selectedCashId);
  const archivedSales = selectedCash ? sales.filter((sale) => sale.cashSessionId === selectedCash.id) : [];

  return <section className={styles.cashHistorySection}>
    <div className={styles.cashHistoryHeader}><div><span>Archivo de cajas</span><h2>Cierres anteriores</h2></div><div className={styles.cashDateFilter}><label>Jornada de cierre<input type="date" value={closeDate} max={businessDateKey(new Date(), settings.operationalCloseHour)} onChange={(event) => { setCloseDate(event.target.value); setPage(1); }} /></label>{closeDate && <button className={styles.smallButton} onClick={() => { setCloseDate(""); setPage(1); }}>Ver todas</button>}</div></div>
    <Panel title={`Historial de cierres (${filtered.length})`}>
      <div className={styles.tableWrap}><table><thead><tr><th>Area</th><th>Responsable</th><th>Apertura</th><th>Cierre</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th /></tr></thead><tbody>{visibleCashSessions.map((cash) => <tr key={cash.id}><td>{labelArea(cash.area)}</td><td>{cash.closedBy ?? cash.openedBy}</td><td>{date(cash.openedAt)}</td><td>{cash.closedAt ? date(cash.closedAt) : "-"}</td><td>{money(cash.expectedAmount ?? 0)}</td><td>{cashReviewLabel(cash.countedAmount)}</td><td className={(cash.difference ?? 0) < 0 ? styles.low : ""}>{cashReviewLabel(cash.difference)}</td><td><div className={styles.rowActions}><button className={styles.smallButton} onClick={() => setSelectedCashId(cash.id)}>Ver tickets</button><button className={styles.smallButton} onClick={() => printCashClose(settings, cash, sales)}>Reimprimir cierre</button></div></td></tr>)}</tbody></table></div>
      <ListEmpty show={!filtered.length} text={closed.length ? "No hay cierres en esa jornada." : "Todavia no hay cierres de caja."} />
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
          <thead><tr><th>Producto</th>{!hideCategory && <th>Etiqueta</th>}<th>Precio</th>{!menuOnly && <th>Stock</th>}{!menuOnly && <th>Min.</th>}<th /></tr></thead>
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
    return <button key={product.id} className={`${styles.productCard} ${lowStock ? styles.negativeStockCard : ""}`} onClick={() => onPick(product.id)}><strong>{product.name}</strong><span>{hideCategory ? money(product.price) : `${product.category} - ${money(product.price)}`}</span><small className={styles.productAreaTag}>{product.area === "drugstore" ? "Stock" : "Menu"}</small>{showStock && product.area === "drugstore" && <span>Stock: {product.stock}</span>}</button>;
  })}</div>;
}

function Cart({ items, onQty }: { items: LineItem[]; onQty: (id: string, delta: number) => void }) {
  if (!items.length) return <div className={styles.empty}>El pedido esta vacio.</div>;
  return <div className={styles.cartList}>{items.map((item) => <div className={styles.cartItem} key={item.productId}><div><strong>{item.name}</strong><span>{item.area ? `${labelArea(item.area)} - ` : ""}{item.qty} x {money(item.price)} = {money(item.qty * item.price)}</span></div><div className={styles.qtyControls}><button onClick={() => onQty(item.productId, -1)}>-</button><strong>{item.qty}</strong><button onClick={() => onQty(item.productId, 1)}>+</button></div></div>)}</div>;
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
  return <div className={styles.settingsForm}><label>Nombre del local<input value={settings.businessName} onChange={(event) => setSettings({ ...settings, businessName: event.target.value })} /></label><label>Direccion<input value={settings.businessAddress} onChange={(event) => setSettings({ ...settings, businessAddress: event.target.value })} /></label><label>Telefono<input value={settings.businessPhone} onChange={(event) => setSettings({ ...settings, businessPhone: event.target.value })} /></label><label>Hora de corte de jornada<input type="time" value={settings.operationalCloseHour} onChange={(event) => setSettings({ ...settings, operationalCloseHour: event.target.value })} /></label><label>Texto al pie del ticket<input value={settings.ticketFooter} onChange={(event) => setSettings({ ...settings, ticketFooter: event.target.value })} /></label><button className={styles.primaryCompact} onClick={() => onSave(settings)}>Guardar ajustes</button></div>;
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
        {isBar && <label>Etiqueta<select value={draft.category || "Comida"} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option>Comida</option><option>Bebidas</option><option>Postre</option></select></label>}
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

function filterMenuProducts(products: Product[], query: string, category: MenuFilter) {
  const normalized = normalize(query);
  return products.filter((product) => {
    if (product.area !== "bar") return false;
    if (category !== "Todos" && product.category !== category) return false;
    return normalize(`${product.name} ${product.category}`).includes(normalized);
  });
}

function filterSaleProducts(products: Product[], filter: SaleFilter, query: string) {
  const normalized = normalize(query);
  return products.filter((product) => (filter === "all" || product.area === filter) && normalize(`${product.name} ${product.category} ${product.barcodes.join(" ")}`).includes(normalized));
}

function total(items: LineItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function salesTotal(sales: Sale[]) {
  return sales.reduce((sum, sale) => sum + sale.total, 0);
}

function paymentTotal(sales: Sale[], payment: string) {
  return sales.filter((sale) => sale.payment === payment).reduce((sum, sale) => sum + sale.total, 0);
}

function currentOpenCashSession(cashSessions: CashSession[], closeHour: string) {
  const openSessions = cashSessions
    .filter((cash) => cash.status === "abierta")
    .slice()
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
  const currentBusinessDate = businessDateKey(new Date(), closeHour);
  return openSessions.find((cash) => businessDateKey(new Date(cash.openedAt), closeHour) === currentBusinessDate) ?? openSessions[0];
}

function hiddenOpenCashSessions(cashSessions: CashSession[], current?: CashSession) {
  return cashSessions
    .filter((cash) => cash.status === "abierta" && cash.id !== current?.id)
    .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
}

function itemArea(item: LineItem, products: Product[]) {
  return item.area ?? products.find((product) => product.id === item.productId)?.area ?? "bar";
}

function uniqueSaleAreas(items: LineItem[], products: Product[]) {
  return [...new Set(items.map((item) => itemArea(item, products)))] as Area[];
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

function cashSpansBusinessDays(cashSession: CashSession, closeHour: string) {
  return businessDateKey(new Date(cashSession.openedAt), closeHour) !== businessDateKey(new Date(), closeHour);
}

function cashReviewLabel(value?: number) {
  return typeof value === "number" ? money(value) : "Sin revisar";
}

function money(value: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0);
}

function date(value: string) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function timeOnly(value: string) {
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function durationSince(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "recien";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function businessDateKey(value: Date, closeHour: string) {
  const businessDate = new Date(value);
  businessDate.setMinutes(businessDate.getMinutes() - parseTimeMinutes(closeHour));
  return dateKey(businessDate);
}

function parseTimeMinutes(value: string) {
  if (!isValidTime(value)) return 180;
  const [hours = 3, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isValidTime(value?: string): value is string {
  return Boolean(value && /^\d{2}:\d{2}$/.test(value));
}

function operationalCutoffFor(value: Date, closeHour: string) {
  const cutoff = new Date(value);
  const minutes = parseTimeMinutes(closeHour);
  cutoff.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return cutoff;
}

function operationalReminderFor(value: Date) {
  const reminder = new Date(value);
  reminder.setHours(0, 50, 0, 0);
  return reminder;
}

function cashSessionNotice(cashSession: CashSession, closeHour: string) {
  const now = new Date();
  const cutoff = operationalCutoffFor(now, closeHour);
  const reminderStart = operationalReminderFor(now);
  const openedAt = new Date(cashSession.openedAt);
  if (now >= cutoff && openedAt < cutoff) {
    return {
      tone: "danger" as const,
      title: "Caja pendiente de cierre",
      text: `La jornada cerro a las ${closeHour}. Cerren la caja para iniciar una jornada limpia.`,
    };
  }
  if (now >= reminderStart && now < cutoff && openedAt < cutoff) {
    return {
      tone: "soft" as const,
      title: "Recordatorio de cierre",
      text: `La jornada cierra a las ${closeHour}. Conviene ir preparando el cierre de caja.`,
    };
  }
  return null;
}

function labelArea(area: Area | "general") {
  if (area === "general") return "Caja unica";
  return area === "bar" ? "Bar" : "Drugstore";
}

function ticketAreaLabel(sale: Sale) {
  const areas = [...new Set(sale.items.map((item) => item.area).filter(Boolean))];
  return areas.length > 1 ? "Venta mixta" : labelArea(sale.area);
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

function nextTicketNumber(area: Area) {
  const prefix = area === "bar" ? "B" : "D";
  return `${prefix}-${ticketStamp()}`;
}

function nextUnifiedTicketNumber() {
  return `V-${ticketStamp()}`;
}

function ticketStamp() {
  const now = new Date();
  const datePart = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  return `${datePart}-${timePart}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
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

function normalizeTables(tables: TableOrder[]) {
  const normalized = tables.slice().sort(compareTables).slice(0, MAX_TABLES);
  while (normalized.length < MAX_TABLES) {
    normalized.push({ id: crypto.randomUUID(), name: `Mesa ${normalized.length + 1}`, status: "vacio", items: [] });
  }
  return normalized.map((table, index) => ({
    ...table,
    name: `Mesa ${index + 1}`,
    status: table.items.length ? (table.status === "entregado" ? "entregado" as const : "preparacion" as const) : "vacio" as const,
    openedAt: table.items.length ? (table.openedAt ?? new Date().toISOString()) : undefined,
  }));
}

function normalizeState(state: AppState): AppState {
  return {
    ...state,
    settings: normalizeSettings(state.settings),
    products: state.products.map((product) => {
      const legacyProduct = product as Product & { barcode?: string };
      const barcodes = Array.isArray(legacyProduct.barcodes)
        ? legacyProduct.barcodes.filter(Boolean)
        : (legacyProduct.barcode ? [legacyProduct.barcode] : []);
      return product.area === "bar"
        ? { ...product, barcodes, category: normalizeMenuCategory(product), stock: product.stock || 999999, min: 0 }
        : { ...product, barcodes, category: product.category || "Stock" };
    }),
    sales: state.sales.map((sale, index) => ({ ...sale, cashSessionId: sale.cashSessionId ?? "", ticketNumber: sale.ticketNumber || `${sale.area === "bar" ? "B" : "D"}-${String(index + 1).padStart(4, "0")}` })),
    tables: normalizeTables(state.tables),
    cashSessions: (state.cashSessions ?? []).map((cash) => ({ ...cash, openedBy: cash.openedBy ?? "Usuario", movements: cash.movements ?? [] })),
  };
}

function normalizeSettings(settings: Partial<AppState["settings"]> | undefined): AppState["settings"] {
  const operationalCloseHour = settings?.operationalCloseHour;
  return {
    ...seedState.settings,
    ...settings,
    operationalCloseHour: isValidTime(operationalCloseHour) ? operationalCloseHour : seedState.settings.operationalCloseHour,
  };
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeMenuCategory(product: Product) {
  if (menuCategories.includes(product.category as MenuFilter) && product.category !== "Todos") return product.category;
  return inferMenuCategory(product.name);
}

function inferMenuCategory(name: string): MenuCategory {
  const value = normalize(name);
  if (/(agua|coca|sprite|fanta|cerveza|vino|gin|tonic|fernet|whisky|vodka|mojito|cafe|te|jugo|gaseosa|bebida|lata|botella)/.test(value)) return "Bebidas";
  if (/(postre|brownie|helado|torta|flan|panqueque|budin|chocotorta|cheesecake|alfajor)/.test(value)) return "Postre";
  return "Comida";
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


  const rawTables = (tablesResult.data ?? []).map((row) => row.payload as TableOrder);
  const normalizedTables = normalizeTables(rawTables);
  const rawTablesById = new Map(rawTables.map((table) => [table.id, table]));
  const correctedTables = normalizedTables.filter((table) => JSON.stringify(rawTablesById.get(table.id)) !== JSON.stringify(table));
  if (correctedTables.length) {
    const updatedAt = new Date().toISOString();
    const { error: correctionError } = await supabase.from("bar_tables").upsert(correctedTables.map((table) => ({ id: table.id, payload: table, updated_at: updatedAt })));
    if (correctionError) throw correctionError;
  }

  return normalizeState({
    settings,
    products: (productsResult.data ?? []).map((row) => row.payload as Product),
    sales: (salesResult.data ?? []).map((row) => row.payload as Sale),
    tables: normalizedTables,
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
  ticket.innerHTML = `<header><h2>${settings.businessName}</h2><p>${settings.businessAddress}</p>${settings.businessPhone ? `<p>${settings.businessPhone}</p>` : ""}</header><hr><div class="ticketMeta"><p>Ticket: ${sale.ticketNumber}</p><p>Fecha: ${date(sale.createdAt)}</p><p>Area: ${ticketAreaLabel(sale)}</p><p>Cliente: ${sale.customer}</p></div><hr><div class="ticketItems">${sale.items.map((item) => `<div class="ticketItem"><strong>${item.name}</strong><div><span>${item.area ? `${labelArea(item.area)} - ` : ""}${item.qty} x ${money(item.price)}</span><strong>${money(item.qty * item.price)}</strong></div></div>`).join("")}</div><hr><div class="ticketTotal"><span>TOTAL</span><strong>${money(sale.total)}</strong></div><p>Pago: ${sale.payment}</p><footer>${settings.ticketFooter}</footer>`;
  document.body.appendChild(ticket);
  window.requestAnimationFrame(() => window.print());
}

function printCashClose(settings: AppState["settings"], cashSession: CashSession, sales: Sale[]) {
  const old = document.getElementById("printTicket");
  old?.remove();
  const sessionSales = sales.filter((sale) => sale.cashSessionId === cashSession.id);
  const totalSold = sessionSales.reduce((sum, sale) => sum + sale.total, 0);
  const ticket = document.createElement("section");
  ticket.id = "printTicket";
  ticket.innerHTML = `<header><h2>${settings.businessName}</h2><p>CIERRE DE CAJA</p><p>${labelArea(cashSession.area)}</p></header><hr><div class="ticketMeta"><p>Apertura: ${date(cashSession.openedAt)}</p><p>Cierre: ${cashSession.closedAt ? date(cashSession.closedAt) : "Caja abierta"}</p><p>Operaciones: ${sessionSales.length}</p></div><hr><div class="ticketItems"><div class="ticketItem"><div><span>Total vendido</span><strong>${money(totalSold)}</strong></div></div><div class="ticketItem"><div><span>Efectivo inicial</span><strong>${money(cashSession.openingAmount)}</strong></div></div><div class="ticketItem"><div><span>Ventas efectivo</span><strong>${money(paymentTotal(sessionSales, "Efectivo"))}</strong></div></div><div class="ticketItem"><div><span>Transferencias</span><strong>${money(paymentTotal(sessionSales, "Transferencia"))}</strong></div></div><div class="ticketItem"><div><span>Tarjetas</span><strong>${money(paymentTotal(sessionSales, "Tarjeta"))}</strong></div></div><div class="ticketItem"><div><span>Cuenta corriente</span><strong>${money(paymentTotal(sessionSales, "Cuenta corriente"))}</strong></div></div><div class="ticketItem"><div><span>Ingresos</span><strong>${money(movementTotal(cashSession, "ingreso"))}</strong></div></div><div class="ticketItem"><div><span>Gastos</span><strong>-${money(movementTotal(cashSession, "gasto"))}</strong></div></div><div class="ticketItem"><div><span>Retiros</span><strong>-${money(movementTotal(cashSession, "retiro"))}</strong></div></div></div><hr><div class="ticketTotal"><span>EFECTIVO ESPERADO</span><strong>${money(cashSession.expectedAmount ?? cashExpected(cashSession, sales))}</strong></div><div class="ticketTotal"><span>CONTADO</span><strong>${cashReviewLabel(cashSession.countedAmount)}</strong></div><div class="ticketTotal"><span>DIFERENCIA</span><strong>${cashReviewLabel(cashSession.difference)}</strong></div><footer>Cierre guardado en el sistema</footer>`;
  document.body.appendChild(ticket);
  window.requestAnimationFrame(() => window.print());
}
