import { InvoiceLabels } from './invoice-html';

export interface InvoiceLanguage {
  /** The language's own name, for the picker. */
  name: string;
  labels: InvoiceLabels;
}

const ORDER: (keyof InvoiceLabels)[] = [
  'invoice',
  'number',
  'issueDate',
  'dueDate',
  'period',
  'billTo',
  'description',
  'hours',
  'rate',
  'amount',
  'subtotal',
  'tax',
  'total',
];

const lang = (name: string, words: string): InvoiceLanguage => {
  const parts = words.split('|');
  const labels = {} as Record<keyof InvoiceLabels, string>;
  ORDER.forEach((key, i) => (labels[key] = parts[i]));
  return { name, labels };
};

const RO =
  'Factură|Număr factură|Data facturii|Data scadenței|Perioadă|Facturat către|Descriere|Ore|Tarif|Sumă|Subtotal|TVA|Total';

/**
 * Printed-invoice wording per app language, bundled so an invoice can be in
 * the client's language rather than the app's. Order: see `ORDER`.
 */
export const INVOICE_LANGUAGES: Record<string, InvoiceLanguage> = {
  ar: lang(
    'العربية',
    'فاتورة|رقم الفاتورة|تاريخ الفاتورة|تاريخ الاستحقاق|الفترة|فاتورة إلى|الوصف|الساعات|السعر|المبلغ|المجموع الفرعي|الضريبة|الإجمالي',
  ),
  cs: lang(
    'Čeština',
    'Faktura|Číslo faktury|Datum vystavení|Datum splatnosti|Období|Odběratel|Popis|Hodiny|Sazba|Částka|Mezisoučet|DPH|Celkem',
  ),
  de: lang(
    'Deutsch',
    'Rechnung|Rechnungsnummer|Rechnungsdatum|Fällig am|Leistungszeitraum|Rechnung an|Beschreibung|Stunden|Stundensatz|Betrag|Zwischensumme|USt.|Gesamt',
  ),
  en: lang(
    'English',
    'Invoice|Invoice number|Invoice date|Due date|Period|Bill to|Description|Hours|Rate|Amount|Subtotal|Tax|Total',
  ),
  es: lang(
    'Español',
    'Factura|Número de factura|Fecha de factura|Fecha de vencimiento|Período|Facturar a|Descripción|Horas|Tarifa|Importe|Subtotal|IVA|Total',
  ),
  fa: lang(
    'فارسی',
    'فاکتور|شماره فاکتور|تاریخ فاکتور|سررسید|دوره|صورتحساب به|شرح|ساعت|نرخ|مبلغ|جمع جزء|مالیات|جمع کل',
  ),
  fi: lang(
    'Suomi',
    'Lasku|Laskun numero|Laskun päivämäärä|Eräpäivä|Ajanjakso|Laskutettava|Kuvaus|Tunnit|Tuntihinta|Summa|Välisumma|ALV|Yhteensä',
  ),
  fr: lang(
    'Français',
    "Facture|Numéro de facture|Date de facture|Date d'échéance|Période|Facturé à|Description|Heures|Taux|Montant|Sous-total|TVA|Total",
  ),
  hr: lang(
    'Hrvatski',
    'Račun|Broj računa|Datum računa|Datum dospijeća|Razdoblje|Kupac|Opis|Sati|Satnica|Iznos|Međuzbroj|PDV|Ukupno',
  ),
  id: lang(
    'Bahasa Indonesia',
    'Faktur|Nomor faktur|Tanggal faktur|Jatuh tempo|Periode|Ditagihkan kepada|Deskripsi|Jam|Tarif|Jumlah|Subtotal|Pajak|Total',
  ),
  it: lang(
    'Italiano',
    'Fattura|Numero fattura|Data fattura|Data di scadenza|Periodo|Intestata a|Descrizione|Ore|Tariffa|Importo|Subtotale|IVA|Totale',
  ),
  ja: lang(
    '日本語',
    '請求書|請求書番号|請求日|支払期限|対象期間|請求先|内容|時間|単価|金額|小計|消費税|合計',
  ),
  ko: lang(
    '한국어',
    '청구서|청구서 번호|청구일|지급 기한|기간|청구 대상|내역|시간|단가|금액|소계|부가세|합계',
  ),
  nb: lang(
    'Norsk bokmål',
    'Faktura|Fakturanummer|Fakturadato|Forfallsdato|Periode|Faktureres til|Beskrivelse|Timer|Timepris|Beløp|Delsum|MVA|Totalt',
  ),
  nl: lang(
    'Nederlands',
    'Factuur|Factuurnummer|Factuurdatum|Vervaldatum|Periode|Factuur aan|Omschrijving|Uren|Tarief|Bedrag|Subtotaal|Btw|Totaal',
  ),
  pl: lang(
    'Polski',
    'Faktura|Numer faktury|Data wystawienia|Termin płatności|Okres|Nabywca|Opis|Godziny|Stawka|Kwota|Suma częściowa|VAT|Razem',
  ),
  pt: lang(
    'Português',
    'Fatura|Número da fatura|Data da fatura|Data de vencimento|Período|Faturar a|Descrição|Horas|Preço/hora|Montante|Subtotal|IVA|Total',
  ),
  'pt-br': lang(
    'Português (Brasil)',
    'Fatura|Número da fatura|Data de emissão|Vencimento|Período|Faturado para|Descrição|Horas|Valor/hora|Valor|Subtotal|Imposto|Total',
  ),
  ro: lang('Română', RO),
  'ro-md': lang('Română (Moldova)', RO),
  ru: lang(
    'Русский',
    'Счёт|Номер счёта|Дата счёта|Срок оплаты|Период|Плательщик|Описание|Часы|Ставка|Сумма|Промежуточный итог|НДС|Итого',
  ),
  sk: lang(
    'Slovenčina',
    'Faktúra|Číslo faktúry|Dátum vystavenia|Dátum splatnosti|Obdobie|Odberateľ|Popis|Hodiny|Sadzba|Suma|Medzisúčet|DPH|Spolu',
  ),
  sv: lang(
    'Svenska',
    'Faktura|Fakturanummer|Fakturadatum|Förfallodatum|Period|Faktureras till|Beskrivning|Timmar|Timpris|Belopp|Delsumma|Moms|Totalt',
  ),
  tr: lang(
    'Türkçe',
    'Fatura|Fatura numarası|Fatura tarihi|Son ödeme tarihi|Dönem|Fatura edilen|Açıklama|Saat|Saat ücreti|Tutar|Ara toplam|KDV|Toplam',
  ),
  uk: lang(
    'Українська',
    'Рахунок|Номер рахунку|Дата рахунку|Термін оплати|Період|Платник|Опис|Години|Ставка|Сума|Проміжний підсумок|ПДВ|Разом',
  ),
  vi: lang(
    'Tiếng Việt',
    'Hóa đơn|Số hóa đơn|Ngày hóa đơn|Ngày đến hạn|Kỳ|Gửi đến|Mô tả|Số giờ|Đơn giá|Thành tiền|Tạm tính|Thuế|Tổng cộng',
  ),
  zh: lang(
    '简体中文',
    '账单|账单编号|账单日期|到期日|服务期间|付款方|描述|工时|单价|金额|小计|税|合计',
  ),
  'zh-tw': lang(
    '繁體中文',
    '請款單|請款單號碼|開立日期|付款期限|服務期間|付款方|說明|工時|單價|金額|小計|稅|合計',
  ),
};

/** A supported language code for `code` (`de-DE` → `de`); English if unknown. */
export const invoiceLanguage = (code: string | undefined): string => {
  const lower = (code ?? '').toLowerCase();
  if (INVOICE_LANGUAGES[lower]) return lower;
  const base = lower.split('-')[0];
  return INVOICE_LANGUAGES[base] ? base : 'en';
};

export const invoiceLabels = (code: string | undefined): InvoiceLabels =>
  INVOICE_LANGUAGES[invoiceLanguage(code)].labels;
