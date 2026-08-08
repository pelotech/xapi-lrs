# xapi-lrs

### version: 0.9.5

![AppVersion: 0.9.5](https://img.shields.io/badge/AppVersion-0.9.5-informational?style=flat-square)

xapi-lrs Learning Record Store helm chart

**Homepage:** <https://github.com/pelotech/xapi-lrs>

## Installing

```shell
helm install xapi-lrs oci://ghcr.io/pelotech/xapi-lrs/charts/xapi-lrs
```

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` |  |
| auth.adminPassword | string | `""` |  |
| auth.adminUser | string | `"admin"` |  |
| auth.apiKey | string | `""` |  |
| auth.apiSecret | string | `""` |  |
| auth.existingSecret | string | `""` |  |
| auth.existingSecretKeys.adminPassword | string | `"admin-password"` |  |
| auth.existingSecretKeys.apiSecret | string | `"api-secret"` |  |
| auth.existingSecretKeys.migrationPostgresqlPassword | string | `"migration-postgresql-password"` |  |
| auth.existingSecretKeys.postgresqlPassword | string | `"postgresql-password"` |  |
| auth.existingSecretKeys.sessionSecret | string | `"session-secret"` |  |
| auth.sessionSecret | string | `""` |  |
| automountServiceAccountToken | bool | `false` |  |
| commonAnnotations | object | `{}` |  |
| containerPorts.admin | int | `8091` |  |
| containerPorts.http | int | `8081` |  |
| cors.enabled | bool | `false` |  |
| cors.origin | string | `""` |  |
| database.driver | string | `"pg"` |  |
| database.postgresql.database | string | `"xapi_lrs"` |  |
| database.postgresql.host | string | `"postgres"` |  |
| database.postgresql.password | string | `""` |  |
| database.postgresql.port | int | `5432` |  |
| database.postgresql.url | string | `""` |  |
| database.postgresql.user | string | `"xapi_lrs"` |  |
| enableServiceLinks | bool | `false` |  |
| extraEnvVars | list | `[]` |  |
| extraEnvVarsCM | string | `""` |  |
| extraEnvVarsSecret | string | `""` |  |
| fullnameOverride | string | `""` |  |
| gateway.enabled | bool | `false` |  |
| gateway.hostname | string | `""` |  |
| gateway.httpRoute.annotations | object | `{}` |  |
| gateway.httpRoute.extraHostnames | list | `[]` |  |
| gateway.httpRoute.gatewayName | string | `""` |  |
| gateway.httpRoute.gatewayNamespace | string | `""` |  |
| gateway.httpRoute.path | string | `"/"` |  |
| gateway.httpRoute.pathType | string | `"PathPrefix"` |  |
| gateway.httpRoute.port | string | `""` |  |
| gateway.httpRoute.rules | list | `[]` |  |
| gateway.httpRoute.sectionName | string | `""` |  |
| gateway.listenerSet.annotations | object | `{}` |  |
| gateway.listenerSet.enabled | bool | `false` |  |
| gateway.listenerSet.gatewayName | string | `""` |  |
| gateway.listenerSet.gatewayNamespace | string | `""` |  |
| gateway.listenerSet.https.enabled | bool | `true` |  |
| gateway.listenerSet.https.secretName | string | `""` |  |
| gateway.listenerSet.listeners | list | `[]` |  |
| image.digest | string | `""` |  |
| image.pullPolicy | string | `"IfNotPresent"` |  |
| image.pullSecrets | list | `[]` |  |
| image.registry | string | `"ghcr.io"` |  |
| image.repository | string | `"pelotech/xapi-lrs"` |  |
| image.tag | string | `"0.9.5"` |  |
| ingress.annotations | object | `{}` |  |
| ingress.enabled | bool | `false` |  |
| ingress.extraHosts | list | `[]` |  |
| ingress.extraPaths | list | `[]` |  |
| ingress.extraTls | list | `[]` |  |
| ingress.hostname | string | `"xapi-lrs.local"` |  |
| ingress.ingressClassName | string | `""` |  |
| ingress.path | string | `"/"` |  |
| ingress.pathType | string | `"ImplementationSpecific"` |  |
| ingress.tls | bool | `false` |  |
| livenessProbe.httpGet.path | string | `"/healthz"` |  |
| livenessProbe.httpGet.port | string | `"admin"` |  |
| livenessProbe.initialDelaySeconds | int | `10` |  |
| livenessProbe.periodSeconds | int | `10` |  |
| logLevel | string | `"info"` |  |
| metrics.serviceMonitor.enabled | bool | `false` |  |
| metrics.serviceMonitor.honorLabels | bool | `false` |  |
| metrics.serviceMonitor.interval | string | `"30s"` |  |
| metrics.serviceMonitor.labels | object | `{}` |  |
| metrics.serviceMonitor.metricRelabelings | list | `[]` |  |
| metrics.serviceMonitor.namespace | string | `""` |  |
| metrics.serviceMonitor.path | string | `"/metrics"` |  |
| metrics.serviceMonitor.relabelings | list | `[]` |  |
| metrics.serviceMonitor.scrapeTimeout | string | `""` |  |
| migration.enabled | bool | `true` |  |
| migration.postgresql.password | string | `""` |  |
| migration.postgresql.url | string | `""` |  |
| migration.postgresql.user | string | `""` |  |
| nameOverride | string | `""` |  |
| nodeEnv | string | `"production"` |  |
| nodeSelector | object | `{}` |  |
| persistence.accessModes[0] | string | `"ReadWriteOnce"` |  |
| persistence.annotations | object | `{}` |  |
| persistence.enabled | bool | `false` |  |
| persistence.existingClaim | string | `""` |  |
| persistence.mountPath | string | `"/data/pglite"` |  |
| persistence.size | string | `"8Gi"` |  |
| persistence.storageClass | string | `""` |  |
| podAnnotations | object | `{}` |  |
| podLabels | object | `{}` |  |
| podSecurityContext | object | `{}` |  |
| readinessProbe.httpGet.path | string | `"/readyz"` |  |
| readinessProbe.httpGet.port | string | `"admin"` |  |
| readinessProbe.initialDelaySeconds | int | `5` |  |
| readinessProbe.periodSeconds | int | `10` |  |
| replicaCount | int | `1` |  |
| resources | object | `{}` |  |
| securityContext | object | `{}` |  |
| service.nodePorts.admin | string | `""` |  |
| service.nodePorts.http | string | `""` |  |
| service.ports.admin | int | `8091` |  |
| service.ports.http | int | `80` |  |
| service.targetPort.admin | string | `"admin"` |  |
| service.targetPort.http | string | `"http"` |  |
| service.type | string | `"ClusterIP"` |  |
| serviceAccount.annotations | object | `{}` |  |
| serviceAccount.create | bool | `true` |  |
| serviceAccount.name | string | `""` |  |
| tolerations | list | `[]` |  |
| updateStrategy | object | `{}` |  |
| volumeMounts | list | `[]` |  |
| volumes | list | `[]` |  |

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.14.2](https://github.com/norwoodj/helm-docs/releases/v1.14.2)
