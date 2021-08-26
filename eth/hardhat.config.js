require("dotenv").config();

require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("hardhat-gas-reporter");
require("solidity-coverage");
require("@nomiclabs/hardhat-web3");
require("maci-domainobjs");
require("maci-crypto");


// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

task("balance", "Prints an account's balance")
  .addParam("account", "The account's address")
  .setAction(async (taskArgs) => {
    const account = web3.utils.toChecksumAddress(taskArgs.account);
    const balance = await web3.eth.getBalance(account);

    console.log(web3.utils.fromWei(balance, "ether"), "ETH");
  });

task("list_bounties", "List bounties")
  .addParam("hash", "Dataset hash", "15681440893605958136105542719628389980032562080249509287477198087707031153419")
  .setAction(async (taskArgs) => {
    const fs = require("fs");
    const BountyManager = await hre.ethers.getContractFactory('BountyManager');
    const CONTRACT_ADDRESS = fs.readFileSync('./artifacts/.env_contract', 'utf-8');
    const contract = await BountyManager.attach(CONTRACT_ADDRESS);

    wallet = await hre.ethers.getSigner();

    const write_contract = contract.connect(wallet);

    var alias = await write_contract.get_alias(taskArgs.hash);

    console.log("Available bounties on dataset: " + alias);
    tx = await write_contract.query_bounties(taskArgs.hash);
    num_bounties = await write_contract.query_num_bounties(taskArgs.hash);
    const bounties = tx.slice(0, num_bounties).map(function (x) { 
      return {"publickey-1": x[0].toString(), "publickey-2": x[1].toString(), "MSE-Cap":  x[2].toString()}; 
    });
    console.log(bounties);  
  });

  task("list_datasets", "List of datasets with alias")
  .setAction(async (taskArgs) => {
    const fs = require("fs");
    const provider = new hre.ethers.providers.JsonRpcProvider();
    const BountyManager = await hre.ethers.getContractFactory('BountyManager');
    const CONTRACT_ADDRESS = fs.readFileSync('./artifacts/.env_contract', 'utf-8');
    const contract = await BountyManager.attach(CONTRACT_ADDRESS);

    wallet = await hre.ethers.getSigner();

    const write_contract = contract.connect(wallet);
    tx = await write_contract.query_datasets();
    num_datasets = await write_contract.query_num_datasets();
    tx = tx.slice(0, num_datasets);
    const hashes = tx.map(function (x) { return x.toString() });
    const aliases = await Promise.all(tx.map(async function (hash) {
      var alias = await write_contract.get_alias(hash);
      return alias;
    }));
    
    const zip = (a, b) => a.map((k, i) => [k, b[i]]);

    console.log("Available datasets:");
    console.log(zip(aliases, hashes));
  });

task("list_bounty_contributors", "List bounty contributor addresses") 
  .addParam("hash", "Dataset hash", "15681440893605958136105542719628389980032562080249509287477198087707031153419")
  .addParam("publickey", "bounty issuer's publilckey", "./keys/out_public.json")
  .addParam("mse", "mse cap, quantized", "18406")
  .setAction(async (taskArgs) => {
    const fs = require("fs");
    const BountyManager = await hre.ethers.getContractFactory('BountyManager');
    const CONTRACT_ADDRESS = fs.readFileSync('./artifacts/.env_contract', 'utf-8');
    const contract = await BountyManager.attach(CONTRACT_ADDRESS);

    const pubKey = JSON.parse(fs.readFileSync(taskArgs.publickey));
    pubKey[0] = BigInt(pubKey[0]);
    pubKey[1] = BigInt(pubKey[1]);

    wallet = await hre.ethers.getSigner();

    const write_contract = contract.connect(wallet);
    const mse_cap = taskArgs.mse;

    var alias = await write_contract.get_alias(taskArgs.hash);

    console.log("Bounty contributions on dataset: " + alias);
    console.log("with public key " + pubKey);
    console.log("quantized mse " + taskArgs.mse);
    tx = await write_contract.query_bounty_contributors(taskArgs.hash, pubKey, mse_cap);
    const addresses = tx.map(function (x) { 
      return x; 
    });

    const bounties = await Promise.all(addresses.map(async function (addr) {
      var alias = await write_contract.query_bounty_contribution(taskArgs.hash, pubkey, mse_cap, addr);
      return alias;
    }));

    const zip = (a, b) => a.map((k, i) => [k, b[i]]);

    console.log("Contributions for bounty:");
    console.log(zip(addresses, bounties));
  });

task("claim_bounty", "Claim bounty")
  .addParam("payment", "payment address", "0x2546BcD3c84621e976D8185a91A922aE77ECEc30")
  .addParam("publickey", "bounty issuer's publilckey", "./keys/out_public.json")
  .addParam("walletprivatekey", "wallet private key", "./keys/.private_key")
  .addParam("model", "model path", "./model")
  .addParam("dataset", "dataset path", "./dataset")
  .addParam("settings", "settings", "settings.json")
  .setAction(async (taskArgs) => {

    const { execSync } = require("child_process");
    const fs = require("fs");
    const snarkjs = require("snarkjs");

    execSync("python3 scripts/quantize.py --mode model --settings "+ taskArgs.settings + " --model " + taskArgs.model + " --dataset " + taskArgs.dataset, {
      stdio: "inherit",
    });

    const { Keypair } = require('maci-domainobjs');
    const mimc7 = require('./node_modules/circomlib/src/mimc7.js');
    //console.log(Keypair);

    const key = new Keypair();
    const pubKey = JSON.parse(fs.readFileSync(taskArgs.publickey));
    //console.log(pubKey);
    pubKey[0] = BigInt(pubKey[0]);
    pubKey[1] = BigInt(pubKey[1]);

    const key2 = new Keypair();
    //console.log('---------');
    key2.pubKey.rawPubKey = pubKey;
    //console.log(pubKey);
    //console.log(key2.pubKey.rawPubKey);

    const sharedKey = Keypair.genEcdhSharedKey(key.privKey, key2.pubKey);

    const rawdata = fs.readFileSync('./artifacts/quantization/inputs_ml.json');
    const data = JSON.parse(rawdata);
    //console.log(data);

    function tobigint(value) {
      return BigInt(value);
    }

    var to_hash = [];
    var m = 20;
    var p = 4;
    var n = 1;

    var idx = 0;
    for (var i = 0; i < m; i++) {
        for (var j = 0; j < p; j++) {
            to_hash.push(data.X_q[i][j]);
            idx = idx + 1;
            
        }
    }

    for (var i = 0; i < m; i++) {
        for (var j = 0; j < n; j++) {
            to_hash.push(data.Yt_q[i][j]);
            idx = idx + 1;
        }
    }

    to_hash.push(data.z_X);
    idx = idx + 1; 
    to_hash.push(data.z_W);
    idx = idx + 1;
    to_hash.push(data.z_b);
    idx = idx + 1;
    to_hash.push(data.z_Y);
    idx = idx + 1;
    to_hash.push(data.sbsY_numerator);
    idx = idx + 1;
    to_hash.push(data.sbsY_denominator);
    idx = idx + 1;
    to_hash.push(data.sXsWsY_numerator);
    idx = idx + 1;
    to_hash.push(data.sXsWsY_denominator);
    idx = idx + 1;

    to_hash.push(data.sYsR_numerator);
    idx = idx + 1;
    to_hash.push(data.sYsR_denominator);
    idx = idx + 1;
    to_hash.push(data.sYtsR_numerator);
    idx = idx + 1;
    to_hash.push(data.sYtsR_denominator);
    idx = idx + 1;
    to_hash.push(data.constant);
    idx = idx + 1;

    to_hash.push(data.z_R);
    idx = idx + 1;
    to_hash.push(data.z_Sq);
    idx = idx + 1;
    to_hash.push(data.sR2sSq_numerator);
    idx = idx + 1;
    to_hash.push(data.sR2sSq_denominator);
    idx = idx + 1;

    const hash_input = mimc7.multiHash(to_hash.map(tobigint), BigInt(0));

    const W_q_enc = data.W_q.map(function(arr) {
      return arr.slice().map(tobigint);
    });

    const b_q_enc = data.b_q.slice().map(tobigint);

    for (let i = 0; i < b_q_enc.length; i++) {
      var val1 = mimc7.multiHash([b_q_enc[i]], BigInt(0));
      var val2 = mimc7.hash(sharedKey, val1);
      b_q_enc[i] = [val1, b_q_enc[i]+val2];
    }

    //console.log(W_q_enc);

    for (let i = 0; i < W_q_enc.length; i++) {
      for (let j = 0; j < W_q_enc[0].length; j++) {
        var val1 = mimc7.multiHash([W_q_enc[i][j]], BigInt(0));
        var val2 = mimc7.hash(sharedKey, val1);
        W_q_enc[i][j] = [val1, W_q_enc[i][j]+val2];
      }
    }
    //console.log(b_q_enc);
    //console.log(W_q_enc);

    const _input = {
      hash_input: hash_input,
      private_key: key.privKey.asCircuitInputs(),
      public_key: key2.pubKey.asCircuitInputs(),
      W_q_enc : W_q_enc,
      b_q_enc : b_q_enc,
    };

    const input = Object.assign({}, data, _input);

    BigInt.prototype.toJSON = function() { return this.toString(16)  }

    fs.writeFileSync(
      './artifacts/quantization/inputs.json',
      JSON.stringify(input, null, 2),
      () => {},
    );

    const final_zkey = fs.readFileSync("../circuits/artifacts/lr.zkey");
    const wasm = fs.readFileSync("../circuits/artifacts/lr.wasm");
    const wtns = { type: "mem" };

    const logger = {
        debug: () => { },
        info: (x) => { console.log('INFO: ' + x) },
        warn: (x) => { console.log('WARN: ' + x) },
        error: (x) => { console.log('ERROR: ' + x) },
    };

    const verification_key = await snarkjs.zKey.exportVerificationKey(final_zkey);
    console.log('Circuit Outputs:');
    await snarkjs.wtns.calculate(input, wasm, wtns, logger);
    const start = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.prove(final_zkey, wtns, logger);
    console.log("Proof took " + (Date.now() - start) / 1000 + " s");

    const verified = await snarkjs.groth16.verify(verification_key, publicSignals, proof, logger);
    if (!verified) throw new Error("Could not verify the proof");

    arg0 = [proof.pi_a[0], proof.pi_a[1]];
    arg1 = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]]
    arg2 = [proof.pi_c[0], proof.pi_c[1]];
    arg3 = publicSignals;

    const provider = new hre.ethers.providers.JsonRpcProvider();
    const BountyManager = await hre.ethers.getContractFactory('BountyManager');
    const CONTRACT_ADDRESS = fs.readFileSync('./artifacts/.env_contract', 'utf-8');
    const contract = await BountyManager.attach(CONTRACT_ADDRESS);

    const wallet_raw = new hre.ethers.Wallet(fs.readFileSync(taskArgs.walletprivatekey, 'utf-8'));
    const wallet = wallet_raw.connect(provider);

    const write_contract = contract.connect(wallet);

    //console.log([arg0, arg1, arg2]);
    console.log("Paying " + taskArgs.payment);
    console.log("With balance");
    balance = await provider.getBalance(taskArgs.payment);
    console.log(ethers.utils.formatEther(balance));
    
    //arg3[0] = "133";

    //const index_offset = m * p + n * p * 2 + n * 2;
    //console.log(key2.pubKey);
    //console.log(arg3[index_offset+2]);
    //console.log(arg3[index_offset+3]);
    //console.log(arg3[index_offset+2]);
    //console.log(arg0, arg1, arg2, arg3);

    tx = await write_contract.collectBounty(taskArgs.payment, arg0, arg1, arg2, arg3);

    await write_contract.on("BountyCollected", (x) => {
      console.log("Collected Bounty: " + (x.toString()));
    });
    //console.log(tx);

    console.log("Your Public Key: ");
    console.log(key.pubKey.rawPubKey);
    console.log("Your Private Key: ");
    console.log(key.privKey.rawPrivKey);
    //console.log("Success!");

    balance = await provider.getBalance(taskArgs.payment);
    console.log("Current Balance");
    console.log(ethers.utils.formatEther(balance));
  });

task("remove_bounty", "Deposit bounty") 
  .addParam("keyfile", "file prefix to export private and public key", "out")
  .addParam("walletprivatekey", "private key", "./keys/.private_key")
  .addParam("settings", "settings", "settings.json")
  .setAction(async (taskArgs) => {

  });

task("add_bounty", "Deposit bounty") 
  .addParam("amount", "amount to add to bounty", "49")
  .addParam("keyfile", "file prefix to export private and public key", "out")
  .addParam("walletprivatekey", "private key", "./keys/.private_key")
  .addParam("dataset", "dataset path", "./dataset")
  .addParam("settings", "settings", "settings.json")
  .setAction(async (taskArgs) => {

    const { execSync } = require("child_process");
    const fs = require("fs");

    execSync("python3 scripts/quantize.py --mode dataset --settings "+ taskArgs.settings + " --dataset " + taskArgs.dataset, {
      stdio: "inherit",
    });

    const { Keypair } = require('maci-domainobjs');
    const mimc7 = require('./node_modules/circomlib/src/mimc7.js');
    //console.log(mimc7)

    const key = new Keypair();

    const rawdata = fs.readFileSync('./artifacts/quantization/inputs_dataset.json');
    const data = JSON.parse(rawdata);
    //console.log(data);

    function tobigint(value) {
      return BigInt(value);
    }

    var to_hash = [];
    var m = 20;
    var p = 4;
    var n = 1;

    var idx = 0;
    for (var i = 0; i < m; i++) {
        for (var j = 0; j < p; j++) {
            to_hash.push(data.X_q[i][j]);
            idx = idx + 1;
            
        }
    }

    for (var i = 0; i < m; i++) {
        for (var j = 0; j < n; j++) {
            to_hash.push(data.Yt_q[i][j]);
            idx = idx + 1;
        }
    }

    to_hash.push(data.z_X);
    idx = idx + 1; 
    to_hash.push(data.z_W);
    idx = idx + 1;
    to_hash.push(data.z_b);
    idx = idx + 1;
    to_hash.push(data.z_Y);
    idx = idx + 1;
    to_hash.push(data.sbsY_numerator);
    idx = idx + 1;
    to_hash.push(data.sbsY_denominator);
    idx = idx + 1;
    to_hash.push(data.sXsWsY_numerator);
    idx = idx + 1;
    to_hash.push(data.sXsWsY_denominator);
    idx = idx + 1;

    to_hash.push(data.sYsR_numerator);
    idx = idx + 1;
    to_hash.push(data.sYsR_denominator);
    idx = idx + 1;
    to_hash.push(data.sYtsR_numerator);
    idx = idx + 1;
    to_hash.push(data.sYtsR_denominator);
    idx = idx + 1;
    to_hash.push(data.constant);
    idx = idx + 1;

    to_hash.push(data.z_R);
    idx = idx + 1;
    to_hash.push(data.z_Sq);
    idx = idx + 1;
    to_hash.push(data.sR2sSq_numerator);
    idx = idx + 1;
    to_hash.push(data.sR2sSq_denominator);
    idx = idx + 1;

    const hash_input = mimc7.multiHash(to_hash.map(tobigint), BigInt(0));

    console.log("Hashed inputs: ");
    console.log(hash_input);
    console.log("Your Public Key: ");
    console.log(key.pubKey.rawPubKey);
    console.log("Your Private Key: ");
    console.log(key.privKey.rawPrivKey);

    BigInt.prototype.toJSON = function() { return this.toString()  }

    fs.writeFileSync(
      './keys/'+taskArgs.keyfile + '_public.json',
      JSON.stringify(key.pubKey.rawPubKey, null, 2),
      () => {},
    );

    fs.writeFileSync(
      './keys/'+taskArgs.keyfile + '_private.json',
      JSON.stringify(key.privKey.rawPrivKey, null, 2),
      () => {},
    );

    const provider = new hre.ethers.providers.JsonRpcProvider();

    const BountyManager = await hre.ethers.getContractFactory('BountyManager');
    const CONTRACT_ADDRESS = fs.readFileSync('./artifacts/.env_contract', 'utf-8');
    const contract = await BountyManager.attach(CONTRACT_ADDRESS);

    const wallet_raw = new hre.ethers.Wallet(fs.readFileSync(taskArgs.walletprivatekey, 'utf-8'));
    
    const wallet = wallet_raw.connect(provider);

    let overrides = {
      // To convert Ether to Wei:
      value: ethers.utils.parseEther(taskArgs.amount)     // ether in this case MUST be a string
    };

    const write_contract = contract.connect(wallet);

    tx = await write_contract.addBounty(hash_input, "dataset", key.pubKey.rawPubKey, data.out, overrides);
   
    //console.log(tx)
    //console.log(hash_input);
    //console.log("Success!");

    balance = await provider.getBalance(wallet.address);
    console.log("Current Balance");
    console.log(ethers.utils.formatEther(balance));
  });
// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.6.11",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      initialBaseFeePerGas: 0, // workaround from https://github.com/sc-forks/solidity-coverage/issues/652#issuecomment-896330136 . Remove when that issue is closed.
    },
    ropsten: {
      url: process.env.ROPSTEN_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};
