/* tslint:disable */
/* eslint-disable */
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import type { TsoaRoute } from '@tsoa/runtime';
import {  fetchMiddlewares, ExpressTemplateService } from '@tsoa/runtime';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { StatementsController } from './../domain/xapi/statements.controller.js';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { StateController } from './../domain/xapi/state.controller.js';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AgentsController } from './../domain/xapi/agents.controller.js';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AgentProfileController } from './../domain/xapi/agent-profile.controller.js';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { ActivityProfileController } from './../domain/xapi/activity-profile.controller.js';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { ActivitiesController } from './../domain/xapi/activities.controller.js';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AboutController } from './../domain/xapi/about.controller.js';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { SystemController } from './../domain/system/controller.js';
import { expressAuthentication } from './../core/authentication.js';
// @ts-ignore - no great way to install types from subpackage
import { iocContainer } from './../core/ioc.js';
import type { IocContainer, IocContainerFactory } from '@tsoa/runtime';
import type { Request as ExRequest, Response as ExResponse, RequestHandler, Router } from 'express';

const expressAuthenticationRecasted = expressAuthentication as (req: ExRequest, securityName: string, scopes?: string[], res?: ExResponse) => Promise<any>;


// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

const models: TsoaRoute.Models = {
    "Account": {
        "dataType": "refObject",
        "properties": {
            "homePage": {"dataType":"string","required":true},
            "name": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Agent": {
        "dataType": "refObject",
        "properties": {
            "mbox": {"dataType":"string"},
            "mbox_sha1sum": {"dataType":"string"},
            "openid": {"dataType":"string"},
            "account": {"ref":"Account"},
            "objectType": {"dataType":"enum","enums":["Agent"]},
            "name": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AnonymousGroup": {
        "dataType": "refObject",
        "properties": {
            "objectType": {"dataType":"enum","enums":["Group"],"required":true},
            "name": {"dataType":"string"},
            "member": {"dataType":"array","array":{"dataType":"refObject","ref":"Agent"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "IdentifiedGroup": {
        "dataType": "refObject",
        "properties": {
            "mbox": {"dataType":"string"},
            "mbox_sha1sum": {"dataType":"string"},
            "openid": {"dataType":"string"},
            "account": {"ref":"Account"},
            "objectType": {"dataType":"enum","enums":["Group"],"required":true},
            "name": {"dataType":"string"},
            "member": {"dataType":"array","array":{"dataType":"refObject","ref":"Agent"}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Group": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"AnonymousGroup"},{"ref":"IdentifiedGroup"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Actor": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"Agent"},{"ref":"Group"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Record_string.string_": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{},"additionalProperties":{"dataType":"string"},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "LanguageMap": {
        "dataType": "refAlias",
        "type": {"ref":"Record_string.string_","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Verb": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "display": {"ref":"LanguageMap"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "InteractionType": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["true-false"]},{"dataType":"enum","enums":["choice"]},{"dataType":"enum","enums":["fill-in"]},{"dataType":"enum","enums":["long-fill-in"]},{"dataType":"enum","enums":["matching"]},{"dataType":"enum","enums":["performance"]},{"dataType":"enum","enums":["sequencing"]},{"dataType":"enum","enums":["likert"]},{"dataType":"enum","enums":["numeric"]},{"dataType":"enum","enums":["other"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "InteractionComponent": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "description": {"ref":"LanguageMap"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Record_string.unknown_": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{},"additionalProperties":{"dataType":"any"},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Extensions": {
        "dataType": "refAlias",
        "type": {"ref":"Record_string.unknown_","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ActivityDefinition": {
        "dataType": "refObject",
        "properties": {
            "name": {"ref":"LanguageMap"},
            "description": {"ref":"LanguageMap"},
            "type": {"dataType":"string"},
            "moreInfo": {"dataType":"string"},
            "interactionType": {"ref":"InteractionType"},
            "correctResponsesPattern": {"dataType":"array","array":{"dataType":"string"}},
            "choices": {"dataType":"array","array":{"dataType":"refObject","ref":"InteractionComponent"}},
            "scale": {"dataType":"array","array":{"dataType":"refObject","ref":"InteractionComponent"}},
            "source": {"dataType":"array","array":{"dataType":"refObject","ref":"InteractionComponent"}},
            "target": {"dataType":"array","array":{"dataType":"refObject","ref":"InteractionComponent"}},
            "steps": {"dataType":"array","array":{"dataType":"refObject","ref":"InteractionComponent"}},
            "extensions": {"ref":"Extensions"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Activity": {
        "dataType": "refObject",
        "properties": {
            "objectType": {"dataType":"enum","enums":["Activity"]},
            "id": {"dataType":"string","required":true},
            "definition": {"ref":"ActivityDefinition"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "StatementRef": {
        "dataType": "refObject",
        "properties": {
            "objectType": {"dataType":"enum","enums":["StatementRef"],"required":true},
            "id": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Score": {
        "dataType": "refObject",
        "properties": {
            "scaled": {"dataType":"double"},
            "raw": {"dataType":"double"},
            "min": {"dataType":"double"},
            "max": {"dataType":"double"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Result": {
        "dataType": "refObject",
        "properties": {
            "score": {"ref":"Score"},
            "success": {"dataType":"boolean"},
            "completion": {"dataType":"boolean"},
            "response": {"dataType":"string"},
            "duration": {"dataType":"string"},
            "extensions": {"ref":"Extensions"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ContextActivities": {
        "dataType": "refObject",
        "properties": {
            "parent": {"dataType":"array","array":{"dataType":"refObject","ref":"Activity"}},
            "grouping": {"dataType":"array","array":{"dataType":"refObject","ref":"Activity"}},
            "category": {"dataType":"array","array":{"dataType":"refObject","ref":"Activity"}},
            "other": {"dataType":"array","array":{"dataType":"refObject","ref":"Activity"}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Context": {
        "dataType": "refObject",
        "properties": {
            "registration": {"dataType":"string"},
            "instructor": {"ref":"Actor"},
            "team": {"ref":"Group"},
            "contextActivities": {"ref":"ContextActivities"},
            "revision": {"dataType":"string"},
            "platform": {"dataType":"string"},
            "language": {"dataType":"string"},
            "statement": {"ref":"StatementRef"},
            "extensions": {"ref":"Extensions"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Attachment": {
        "dataType": "refObject",
        "properties": {
            "usageType": {"dataType":"string","required":true},
            "display": {"ref":"LanguageMap","required":true},
            "description": {"ref":"LanguageMap"},
            "contentType": {"dataType":"string","required":true},
            "length": {"dataType":"double","required":true},
            "sha2": {"dataType":"string","required":true},
            "fileUrl": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "SubStatement": {
        "dataType": "refObject",
        "properties": {
            "objectType": {"dataType":"enum","enums":["SubStatement"],"required":true},
            "actor": {"ref":"Actor","required":true},
            "verb": {"ref":"Verb","required":true},
            "object": {"dataType":"union","subSchemas":[{"ref":"Activity"},{"ref":"Agent"},{"ref":"Group"},{"ref":"StatementRef"}],"required":true},
            "result": {"ref":"Result"},
            "context": {"ref":"Context"},
            "timestamp": {"dataType":"string"},
            "attachments": {"dataType":"array","array":{"dataType":"refObject","ref":"Attachment"}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "StatementObject": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"ref":"Activity"},{"ref":"Agent"},{"ref":"Group"},{"ref":"StatementRef"},{"ref":"SubStatement"}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Statement": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string"},
            "actor": {"ref":"Actor","required":true},
            "verb": {"ref":"Verb","required":true},
            "object": {"ref":"StatementObject","required":true},
            "result": {"ref":"Result"},
            "context": {"ref":"Context"},
            "timestamp": {"dataType":"string"},
            "stored": {"dataType":"string"},
            "authority": {"ref":"Actor"},
            "version": {"dataType":"string"},
            "attachments": {"dataType":"array","array":{"dataType":"refObject","ref":"Attachment"}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "StatementResult": {
        "dataType": "refObject",
        "properties": {
            "statements": {"dataType":"array","array":{"dataType":"refObject","ref":"Statement"},"required":true},
            "more": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "StatementFormat": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["ids"]},{"dataType":"enum","enums":["exact"]},{"dataType":"enum","enums":["canonical"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Person": {
        "dataType": "refObject",
        "properties": {
            "objectType": {"dataType":"enum","enums":["Person"],"required":true},
            "name": {"dataType":"array","array":{"dataType":"string"}},
            "mbox": {"dataType":"array","array":{"dataType":"string"}},
            "mbox_sha1sum": {"dataType":"array","array":{"dataType":"string"}},
            "openid": {"dataType":"array","array":{"dataType":"string"}},
            "account": {"dataType":"array","array":{"dataType":"refObject","ref":"Account"}},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AboutResource": {
        "dataType": "refObject",
        "properties": {
            "version": {"dataType":"array","array":{"dataType":"string"},"required":true},
            "extensions": {"ref":"Extensions"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "HealthcheckResponse": {
        "dataType": "refObject",
        "properties": {
            "status": {"dataType":"string","required":true},
            "version": {"dataType":"string","required":true},
            "uptime": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
};
const templateService = new ExpressTemplateService(models, {"noImplicitAdditionalProperties":"silently-remove-extras","bodyCoercion":true});

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa




export function RegisterRoutes(app: Router) {

    // ###########################################################################################################
    //  NOTE: If you do not see routes for all of your controllers in this file, then you might not have informed tsoa of where to look
    //      Please look into the "controllerPathGlobs" config option described in the readme: https://github.com/lukeautry/tsoa
    // ###########################################################################################################



        const argsStatementsController_getStatements: Record<string, TsoaRoute.ParameterSchema> = {
                statementId: {"in":"query","name":"statementId","dataType":"string"},
                voidedStatementId: {"in":"query","name":"voidedStatementId","dataType":"string"},
                agent: {"in":"query","name":"agent","dataType":"string"},
                verb: {"in":"query","name":"verb","dataType":"string"},
                activity: {"in":"query","name":"activity","dataType":"string"},
                registration: {"in":"query","name":"registration","dataType":"string"},
                related_activities: {"in":"query","name":"related_activities","dataType":"boolean"},
                related_agents: {"in":"query","name":"related_agents","dataType":"boolean"},
                since: {"in":"query","name":"since","dataType":"string"},
                until: {"in":"query","name":"until","dataType":"string"},
                limit: {"in":"query","name":"limit","dataType":"double"},
                format: {"in":"query","name":"format","ref":"StatementFormat"},
                attachments: {"in":"query","name":"attachments","dataType":"boolean"},
                ascending: {"in":"query","name":"ascending","dataType":"boolean"},
                cursor: {"in":"query","name":"cursor","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.get('/xapi/statements',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(StatementsController)),
            ...(fetchMiddlewares<RequestHandler>(StatementsController.prototype.getStatements)),

            async function StatementsController_getStatements(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsStatementsController_getStatements, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<StatementsController>(StatementsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getStatements',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsStatementsController_putStatement: Record<string, TsoaRoute.ParameterSchema> = {
                statementId: {"in":"query","name":"statementId","required":true,"dataType":"string"},
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.put('/xapi/statements',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(StatementsController)),
            ...(fetchMiddlewares<RequestHandler>(StatementsController.prototype.putStatement)),

            async function StatementsController_putStatement(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsStatementsController_putStatement, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<StatementsController>(StatementsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'putStatement',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsStatementsController_postStatements: Record<string, TsoaRoute.ParameterSchema> = {
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
        };
        app.post('/xapi/statements',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(StatementsController)),
            ...(fetchMiddlewares<RequestHandler>(StatementsController.prototype.postStatements)),

            async function StatementsController_postStatements(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsStatementsController_postStatements, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<StatementsController>(StatementsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'postStatements',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsStateController_getState: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
                stateId: {"in":"query","name":"stateId","dataType":"string"},
                registration: {"in":"query","name":"registration","dataType":"string"},
                since: {"in":"query","name":"since","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.get('/xapi/activities/state',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(StateController)),
            ...(fetchMiddlewares<RequestHandler>(StateController.prototype.getState)),

            async function StateController_getState(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsStateController_getState, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<StateController>(StateController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getState',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsStateController_putState: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
                stateId: {"in":"query","name":"stateId","required":true,"dataType":"string"},
                registration: {"in":"query","name":"registration","dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
                ifNoneMatch: {"in":"header","name":"If-None-Match","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.put('/xapi/activities/state',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(StateController)),
            ...(fetchMiddlewares<RequestHandler>(StateController.prototype.putState)),

            async function StateController_putState(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsStateController_putState, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<StateController>(StateController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'putState',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsStateController_postState: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
                stateId: {"in":"query","name":"stateId","required":true,"dataType":"string"},
                registration: {"in":"query","name":"registration","dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
                ifNoneMatch: {"in":"header","name":"If-None-Match","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.post('/xapi/activities/state',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(StateController)),
            ...(fetchMiddlewares<RequestHandler>(StateController.prototype.postState)),

            async function StateController_postState(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsStateController_postState, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<StateController>(StateController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'postState',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsStateController_deleteState: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
                stateId: {"in":"query","name":"stateId","dataType":"string"},
                registration: {"in":"query","name":"registration","dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
        };
        app.delete('/xapi/activities/state',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(StateController)),
            ...(fetchMiddlewares<RequestHandler>(StateController.prototype.deleteState)),

            async function StateController_deleteState(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsStateController_deleteState, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<StateController>(StateController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'deleteState',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAgentsController_getAgent: Record<string, TsoaRoute.ParameterSchema> = {
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
        };
        app.get('/xapi/agents',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(AgentsController)),
            ...(fetchMiddlewares<RequestHandler>(AgentsController.prototype.getAgent)),

            async function AgentsController_getAgent(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAgentsController_getAgent, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<AgentsController>(AgentsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getAgent',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAgentProfileController_getAgentProfile: Record<string, TsoaRoute.ParameterSchema> = {
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
                profileId: {"in":"query","name":"profileId","dataType":"string"},
                since: {"in":"query","name":"since","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.get('/xapi/agents/profile',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(AgentProfileController)),
            ...(fetchMiddlewares<RequestHandler>(AgentProfileController.prototype.getAgentProfile)),

            async function AgentProfileController_getAgentProfile(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAgentProfileController_getAgentProfile, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<AgentProfileController>(AgentProfileController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getAgentProfile',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAgentProfileController_putAgentProfile: Record<string, TsoaRoute.ParameterSchema> = {
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
                profileId: {"in":"query","name":"profileId","required":true,"dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
                ifNoneMatch: {"in":"header","name":"If-None-Match","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.put('/xapi/agents/profile',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(AgentProfileController)),
            ...(fetchMiddlewares<RequestHandler>(AgentProfileController.prototype.putAgentProfile)),

            async function AgentProfileController_putAgentProfile(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAgentProfileController_putAgentProfile, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<AgentProfileController>(AgentProfileController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'putAgentProfile',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAgentProfileController_postAgentProfile: Record<string, TsoaRoute.ParameterSchema> = {
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
                profileId: {"in":"query","name":"profileId","required":true,"dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
                ifNoneMatch: {"in":"header","name":"If-None-Match","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.post('/xapi/agents/profile',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(AgentProfileController)),
            ...(fetchMiddlewares<RequestHandler>(AgentProfileController.prototype.postAgentProfile)),

            async function AgentProfileController_postAgentProfile(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAgentProfileController_postAgentProfile, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<AgentProfileController>(AgentProfileController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'postAgentProfile',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAgentProfileController_deleteAgentProfile: Record<string, TsoaRoute.ParameterSchema> = {
                agent: {"in":"query","name":"agent","required":true,"dataType":"string"},
                profileId: {"in":"query","name":"profileId","required":true,"dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
        };
        app.delete('/xapi/agents/profile',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(AgentProfileController)),
            ...(fetchMiddlewares<RequestHandler>(AgentProfileController.prototype.deleteAgentProfile)),

            async function AgentProfileController_deleteAgentProfile(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAgentProfileController_deleteAgentProfile, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<AgentProfileController>(AgentProfileController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'deleteAgentProfile',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsActivityProfileController_getActivityProfile: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
                profileId: {"in":"query","name":"profileId","dataType":"string"},
                since: {"in":"query","name":"since","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.get('/xapi/activities/profile',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(ActivityProfileController)),
            ...(fetchMiddlewares<RequestHandler>(ActivityProfileController.prototype.getActivityProfile)),

            async function ActivityProfileController_getActivityProfile(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsActivityProfileController_getActivityProfile, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<ActivityProfileController>(ActivityProfileController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getActivityProfile',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsActivityProfileController_putActivityProfile: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
                profileId: {"in":"query","name":"profileId","required":true,"dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
                ifNoneMatch: {"in":"header","name":"If-None-Match","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.put('/xapi/activities/profile',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(ActivityProfileController)),
            ...(fetchMiddlewares<RequestHandler>(ActivityProfileController.prototype.putActivityProfile)),

            async function ActivityProfileController_putActivityProfile(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsActivityProfileController_putActivityProfile, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<ActivityProfileController>(ActivityProfileController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'putActivityProfile',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsActivityProfileController_postActivityProfile: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
                profileId: {"in":"query","name":"profileId","required":true,"dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
                ifNoneMatch: {"in":"header","name":"If-None-Match","dataType":"string"},
                req: {"in":"request","name":"req","dataType":"object"},
        };
        app.post('/xapi/activities/profile',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(ActivityProfileController)),
            ...(fetchMiddlewares<RequestHandler>(ActivityProfileController.prototype.postActivityProfile)),

            async function ActivityProfileController_postActivityProfile(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsActivityProfileController_postActivityProfile, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<ActivityProfileController>(ActivityProfileController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'postActivityProfile',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsActivityProfileController_deleteActivityProfile: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
                profileId: {"in":"query","name":"profileId","required":true,"dataType":"string"},
                ifMatch: {"in":"header","name":"If-Match","dataType":"string"},
        };
        app.delete('/xapi/activities/profile',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(ActivityProfileController)),
            ...(fetchMiddlewares<RequestHandler>(ActivityProfileController.prototype.deleteActivityProfile)),

            async function ActivityProfileController_deleteActivityProfile(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsActivityProfileController_deleteActivityProfile, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<ActivityProfileController>(ActivityProfileController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'deleteActivityProfile',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 204,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsActivitiesController_getActivity: Record<string, TsoaRoute.ParameterSchema> = {
                activityId: {"in":"query","name":"activityId","required":true,"dataType":"string"},
        };
        app.get('/xapi/activities',
            authenticateMiddleware([{"jwt":[]},{"xapi_basic":[]}]),
            ...(fetchMiddlewares<RequestHandler>(ActivitiesController)),
            ...(fetchMiddlewares<RequestHandler>(ActivitiesController.prototype.getActivity)),

            async function ActivitiesController_getActivity(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsActivitiesController_getActivity, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<ActivitiesController>(ActivitiesController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getActivity',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsAboutController_getAbout: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.get('/xapi/about',
            ...(fetchMiddlewares<RequestHandler>(AboutController)),
            ...(fetchMiddlewares<RequestHandler>(AboutController.prototype.getAbout)),

            async function AboutController_getAbout(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsAboutController_getAbout, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<AboutController>(AboutController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getAbout',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsSystemController_healthcheck: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.get('/v1/healthcheck',
            ...(fetchMiddlewares<RequestHandler>(SystemController)),
            ...(fetchMiddlewares<RequestHandler>(SystemController.prototype.healthcheck)),

            async function SystemController_healthcheck(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsSystemController_healthcheck, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<SystemController>(SystemController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'healthcheck',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa


    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    function authenticateMiddleware(security: TsoaRoute.Security[] = []) {
        return async function runAuthenticationMiddleware(request: any, response: any, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            // keep track of failed auth attempts so we can hand back the most
            // recent one.  This behavior was previously existing so preserving it
            // here
            const failedAttempts: any[] = [];
            const pushAndRethrow = (error: any) => {
                failedAttempts.push(error);
                throw error;
            };

            const secMethodOrPromises: Promise<any>[] = [];
            for (const secMethod of security) {
                if (Object.keys(secMethod).length > 1) {
                    const secMethodAndPromises: Promise<any>[] = [];

                    for (const name in secMethod) {
                        secMethodAndPromises.push(
                            expressAuthenticationRecasted(request, name, secMethod[name], response)
                                .catch(pushAndRethrow)
                        );
                    }

                    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

                    secMethodOrPromises.push(Promise.all(secMethodAndPromises)
                        .then(users => { return users[0]; }));
                } else {
                    for (const name in secMethod) {
                        secMethodOrPromises.push(
                            expressAuthenticationRecasted(request, name, secMethod[name], response)
                                .catch(pushAndRethrow)
                        );
                    }
                }
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            try {
                request['user'] = await Promise.any(secMethodOrPromises);

                // Response was sent in middleware, abort
                if (response.writableEnded) {
                    return;
                }

                next();
            }
            catch(err) {
                // Show most recent error as response
                const error = failedAttempts.pop();
                error.status = error.status || 401;

                // Response was sent in middleware, abort
                if (response.writableEnded) {
                    return;
                }
                next(error);
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        }
    }

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
}

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
