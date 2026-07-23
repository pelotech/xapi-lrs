{{/* vim: set filetype=mustache: */}}

{{/*
Expand the name of the chart.
*/}}
{{- define "xapi-lrs.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "xapi-lrs.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "xapi-lrs.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "xapi-lrs.labels" -}}
helm.sh/chart: {{ include "xapi-lrs.chart" . }}
{{ include "xapi-lrs.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/component: lrs
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "xapi-lrs.selectorLabels" -}}
app.kubernetes.io/name: {{ include "xapi-lrs.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "xapi-lrs.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "xapi-lrs.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the proper xapi-lrs image name
*/}}
{{- define "xapi-lrs.image" -}}
{{- $registry := .Values.image.registry -}}
{{- $repository := .Values.image.repository -}}
{{- $ref := ternary (printf "@%s" .Values.image.digest) (printf ":%s" .Values.image.tag) (not (empty .Values.image.digest)) -}}
{{- if $registry -}}
{{- printf "%s/%s%s" $registry $repository $ref -}}
{{- else -}}
{{- printf "%s%s" $repository $ref -}}
{{- end -}}
{{- end -}}

{{/*
Return the name of the Secret holding the sensitive values
*/}}
{{- define "xapi-lrs.secretName" -}}
{{- default (include "xapi-lrs.fullname" .) .Values.auth.existingSecret -}}
{{- end -}}

{{/*
Return auth.sessionSecret if set, else the value already in the chart Secret
(so upgrades don't rotate it), else a new random value.
*/}}
{{- define "xapi-lrs.sessionSecret" -}}
{{- if .Values.auth.sessionSecret -}}
{{- .Values.auth.sessionSecret -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace (include "xapi-lrs.fullname" .) -}}
{{- if and $existing $existing.data (index $existing.data "session-secret") -}}
{{- index $existing.data "session-secret" | b64dec -}}
{{- else -}}
{{- randAlphaNum 64 -}}
{{- end -}}
{{- end -}}
{{- end -}}
