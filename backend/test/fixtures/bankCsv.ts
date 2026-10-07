/** A synthetic Sparkasse-style CSV export (semicolon, German dates/decimals, Windows-1252). */
export const SPARKASSE_HEADER =
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';

export const sparkasseRows = [
  '"DE00123";"01.10.26";"01.10.26";"LOHN GEHALT";"Gehalt Oktober";"Employer GmbH";"DE11";"BIC";"3.750,00";"EUR";"Umsatz gebucht"',
  '"DE00123";"02.10.26";"02.10.26";"LASTSCHRIFT";"REWE Markt; Filiale 123";"REWE";"DE22";"BIC";"-52,40";"EUR";"Umsatz gebucht"',
  '"DE00123";"03.10.26";"03.10.26";"DAUERAUFTRAG";"Miete Oktober";"Hausverwaltung Müller";"DE33";"BIC";"-912,00";"EUR";"Umsatz gebucht"',
  '"DE00123";"04.10.26";"04.10.26";"KARTENZAHLUNG";"NETFLIX.COM";"Netflix";"DE44";"BIC";"-12,99";"EUR";"Umsatz gebucht"',
  '"DE00123";"05.10.26";"05.10.26";"KARTENZAHLUNG";"Bäckerei Schäfer";"Bäckerei";"DE55";"BIC";"-4,80";"EUR";"Umsatz gebucht"',
];

export function sparkasseCsv(rows = sparkasseRows, encoding: 'latin1' | 'utf8' = 'latin1'): Buffer {
  return Buffer.from([SPARKASSE_HEADER, ...rows, ''].join('\r\n'), encoding);
}
