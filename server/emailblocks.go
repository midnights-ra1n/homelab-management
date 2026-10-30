package main

// Block-based alert e-mail (setting email_blocks), the default editing mode. The raw HTML
// template (email_html) remains available as the advanced mode (email_mode = "html").

import (
	"bytes"
	"encoding/json"
	"html/template"
	"net/url"
	"strconv"
	"strings"
)

type emailBlock struct {
	ID    string `json:"id"`
	Type  string `json:"type"` // header, summary, events, text, button, divider, footer
	Text  string `json:"text,omitempty"`
	Label string `json:"label,omitempty"`
	URL   string `json:"url,omitempty"`
}

const defaultEmailBlocks = `[
{"id":"h","type":"header","text":"{titre}"},
{"id":"s","type":"summary"},
{"id":"e","type":"events"},
{"id":"b","type":"button","label":"Ouvrir le tableau de bord"},
{"id":"f","type":"footer","text":"Message envoyé automatiquement le {date}."}
]`

var emailBlockTypes = map[string]bool{"header": true, "summary": true, "events": true, "text": true, "button": true, "divider": true, "footer": true}

func parseEmailBlocks(raw string) ([]emailBlock, string) {
	var blocks []emailBlock
	if err := json.Unmarshal([]byte(raw), &blocks); err != nil {
		return nil, "Blocs d'e-mail invalides : " + err.Error()
	}
	if len(blocks) > 30 {
		return nil, "L'e-mail peut contenir au plus 30 blocs"
	}
	for _, b := range blocks {
		if !emailBlockTypes[b.Type] {
			return nil, "Type de bloc inconnu : " + b.Type
		}
		if len(b.Text) > 5000 || len(b.Label) > 100 || len(b.URL) > 500 {
			return nil, "Texte limité à 5 000 caractères, libellé à 100 et lien à 500"
		}
		if b.URL != "" {
			u, err := url.Parse(b.URL)
			if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
				return nil, "Le lien du bouton doit commencer par http:// ou https://"
			}
		}
	}
	return blocks, ""
}

// Placeholders usable in text blocks, replaced before HTML escaping.
func fillPlaceholders(text string, d emailData) string {
	return strings.NewReplacer(
		"{titre}", d.Title, "{date}", d.Date, "{pannes}", strconv.Itoa(d.Down),
		"{avertissements}", strconv.Itoa(d.Warnings), "{changements}", strconv.Itoa(len(d.Events)),
	).Replace(text)
}

var emailBlockTpl = template.Must(template.New("blocks").Funcs(template.FuncMap{
	"lines": func(s string) []string { return strings.Split(s, "\n") },
}).Parse(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<style>@media (max-width:600px){.wrap{padding:0 !important}.card{border-radius:0 !important;border-left:0 !important;border-right:0 !important}.pad{padding-left:16px !important;padding-right:16px !important}.ev{font-size:16px !important}.meta{font-size:14px !important}.btn{display:block !important;text-align:center !important;padding:14px !important;font-size:16px !important}}</style></head>
<body style="margin:0;background:#f2f6f8;font-family:Geist,system-ui,-apple-system,'Segoe UI',sans-serif;color:#131b1f;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="wrap" align="center" style="padding:24px">
<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d8dfe3;border-radius:6px">
{{range .Blocks}}{{if eq .Type "header"}}<tr><td class="pad" style="padding:16px;border-bottom:1px solid #e7ecef"><div style="font-size:18px;font-weight:600">{{.Text}}</div></td></tr>
{{else if eq .Type "summary"}}<tr><td class="pad" style="padding:16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td><div style="font-size:13px;color:#546066">En panne</div><div style="font-size:24px;font-weight:600;color:#9d3533">{{$.D.Down}}</div></td>
<td><div style="font-size:13px;color:#546066">Avertissements</div><div style="font-size:24px;font-weight:600;color:#8a4e00">{{$.D.Warnings}}</div></td>
<td><div style="font-size:13px;color:#546066">Changements</div><div style="font-size:24px;font-weight:600">{{len $.D.Events}}</div></td>
</tr></table></td></tr>
{{else if eq .Type "events"}}{{range $.D.Events}}<tr><td class="pad ev" style="padding:12px 16px;border-top:1px solid #e7ecef;font-size:15px;line-height:1.45">
<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:500;color:#ffffff;background:{{.Color}}">{{.ToLabel}}</span>
<strong style="font-weight:600;margin-left:6px">{{.Name}}</strong> <span style="color:#546066">({{.Kind}})</span>
<div class="meta" style="font-size:13px;color:#546066;margin-top:4px;line-height:1.45">{{if .FromLabel}}{{.FromLabel}} → {{.ToLabel}} à {{.Time}}{{else}}{{.Time}}{{end}}{{if .Message}} · {{.Message}}{{end}}</div>
</td></tr>{{end}}
{{else if eq .Type "text"}}<tr><td class="pad ev" style="padding:12px 16px;font-size:15px;line-height:1.55">{{range $i, $l := lines .Text}}{{if $i}}<br>{{end}}{{$l}}{{end}}</td></tr>
{{else if eq .Type "button"}}{{if .URL}}<tr><td class="pad" style="padding:16px"><a class="btn" href="{{.URL}}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#3fbfa6;color:#09251f;font-size:14px;font-weight:500;text-decoration:none">{{.Label}}</a></td></tr>{{end}}
{{else if eq .Type "divider"}}<tr><td class="pad" style="padding:0 16px"><div style="border-top:1px solid #e7ecef"></div></td></tr>
{{else if eq .Type "footer"}}<tr><td class="pad" style="padding:12px 16px;font-size:13px;color:#67727a;border-top:1px solid #e7ecef">{{.Text}}</td></tr>
{{end}}{{end}}
</table></td></tr></table></body></html>`))

func renderEmailBlocks(blocks []emailBlock, d emailData) (string, error) {
	filled := make([]emailBlock, len(blocks))
	for i, b := range blocks {
		b.Text, b.Label = fillPlaceholders(b.Text, d), fillPlaceholders(b.Label, d)
		if b.Type == "button" && b.URL == "" {
			b.URL = d.URL // dashboard address (HLT_PUBLIC_URL); the block is skipped without one
		}
		filled[i] = b
	}
	var buf bytes.Buffer
	err := emailBlockTpl.Execute(&buf, map[string]any{"Blocks": filled, "D": d})
	return buf.String(), err
}

// renderAlert builds subject and body with the configured mode.
func (s *Server) renderAlert(subjectTpl, mode, htmlTpl, blocksJSON string, d emailData) (string, string, error) {
	if mode != "html" {
		blocks, msg := parseEmailBlocks(blocksJSON)
		if msg != "" {
			return "", "", errString(msg)
		}
		subj, _, err := renderEmail(subjectTpl, "", d)
		if err != nil {
			return "", "", err
		}
		body, err := renderEmailBlocks(blocks, d)
		return subj, body, err
	}
	return renderEmail(subjectTpl, htmlTpl, d)
}

type errString string

func (e errString) Error() string { return string(e) }
