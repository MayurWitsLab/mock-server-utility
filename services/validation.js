const { formatted_error } = require("../utils/utils");
const Ajv = require("ajv");
const ajv = new Ajv({
  allErrors: true,
  strict: "log",
});
const {
  createAuthorizationHeader,
  isHeaderValid,
} = require("ondc-crypto-sdk-nodejs");
const { buildTemplate,getPublicKey } = require("../utils/utils");
const { trigger } = require("./triggerService");
const { ack, schemaNack } = require("../utils/acknowledgement");
const operator = require("../operator/util.js");
const addFormats = require("ajv-formats");
addFormats(ajv);
require("ajv-errors")(ajv);
const log = require("../utils/logger");
//schema validation

var logger;

const validateSchema = async (context) => {
  logger = log.init();
  logger.info(
    `Inside schema validation service for ${context?.req_body?.context?.action} api`
  );
  try {
    const validate = ajv.compile(context.apiConfig.schema);
    const valid = validate(context.req_body);
    if (!valid) {
      let error_list = validate.errors;
      logger.error(JSON.stringify(formatted_error(error_list)));
      logger.error("Schema validation : FAIL");
      logger.error(context?.req_body?.context?.transaction_id)
      return {status:false,error_list:error_list}
    } else {
      logger.info("Schema validation : SUCCESS");
      return {status:true,error_list:[]}
    }
  } catch (error) {
    return {status:false,error_list:error.message}
        logger.error(error);
  }
};

const validateRequest = async (
  context,
  callbackConfig,
  res,
  security,
  server,
  isFormFound,
  flag
) => {
  logger = log.init();
    const {status,error_list} = await validateSchema(context)
  if (isFormFound ||  status) {
    if(callbackConfig.callbacks){
      for (let i = 0 ; i < callbackConfig.callbacks.length ; i++){
        // console.log(i)
        validateRequest(context,callbackConfig.callbacks[i],res,security,server,isFormFound,i===0?false:true)
      }
      console.log("first call to validateSchema")
      return
  }

    //triggering the subsequent request
    payloadConfig = callbackConfig?.payload;
    if (payloadConfig != null) {
      let data = "";
      if (payloadConfig["template"]) {
        data = buildTemplate(context, callbackConfig?.payload?.template);
      }
      if (security.generate_sign) {
        //create response header
        const header = await createAuthorizationHeader({
          body: data,
          privateKey: security.privatekey,
          subscriberId: security.subscriber_id, // Subscriber ID that you get after registering to ONDC Network
          subscriberUniqueKeyId: security.ukId, // Unique Key Id or uKid that you get after registering to ONDC Network
        });

        if(!flag){res.setHeader("Authorization", header);}
      }
      console.log('payloadConfig', payloadConfig)
      console.log('data', data)
      if (callbackConfig.callback === "undefined"|| server.sync_mode  && !flag ) {
        return isFormFound ? res.send(payloadConfig) : res.json(data);
        // return res.json(data);
      } else {
        context.response_uri = resolveObject(context, callbackConfig.uri);
        logger.info(`Callback for this request: ${callbackConfig.callback}`);
        trigger(context, callbackConfig, data,security);
      }
      return !flag?res.json(ack):false
    } 
  }
  else {
      schemaNack.error.path = JSON.stringify(error_list)
      return !flag?res.json(schemaNack):false
    }
  }


const verifyHeader = async (req, security) => {
  logger = log.init();
  const headers = req.headers;
  const public_key = await getPublicKey(security.lookup_uri, headers);
  // logger.info(`Public key retrieved from registry : ${public_key}`);
  // const public_key = security.publickey;
  //Validate the request source against the registry
  const isValidSource = await isHeaderValid({
    header: headers.authorization, // The Authorisation header sent by other network participants
    body: req.rawBody,
    publicKey: public_key,
  });
  if (!isValidSource) {
    return false;
  }
  logger.info("Authorization header verified");
  return true;
};
function resolveObject(context, obj) {
  if (obj["operation"]) {
    return operator.evaluateOperation(context, obj["operation"]);
  } else if (obj["value"]) {
    return obj["value"];
  }
  return obj;
}

module.exports = { validateSchema, validateRequest, verifyHeader };
