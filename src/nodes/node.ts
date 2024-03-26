import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import http, { IncomingMessage, ServerResponse } from "http";
import { delay } from "../utils";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // We use the types.ts file to initialize !!
  let nodeState: NodeState = {
    killed: isFaulty,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // TODO implement this
  // this route allows retrieving the current status of the node
  // node.get("/status", (req, res) => {});
  node.get("/status", (req, res) => {
    if (isFaulty === true) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // TODO implement this
  // this route allows the node to receive messages from other nodes
  // node.post("/message", (req, res) => {});
  node.post("/message", async (req: Request<any, any, any, any>, res: Response<any>) => {
    if (!nodeState.killed && !isFaulty) {
      handleMessage(req.body);
    }
    res.status(200).send("success");
  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  // node.get("/start", async (req, res) => {});
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(100);
    }

    if (!isFaulty) {
      initializeNodeState();
      sendInitialProposals();
    } else {
      resetNodeState();
    }

    res.status(200).send("started");
  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  // node.get("/stop", async (req, res) => {});
  node.get("/stop", async (req, res) => {
    nodeState.killed = true;
    res.status(200).send("killed");
  });

  // TODO implement this
  // get the current state of a node
  // node.get("/getState", (req, res) => {});
  node.get("/getState", (req, res) => {
    if (isFaulty) {
      res.send({
        killed: nodeState.killed,
        decided: null,
        x: null,
        k: null,
      });
    } else {
      res.send(nodeState);
    }
  });

  // toutes mes fonctions:
  // Fonction pour initialiser l'état du nœud
  function initializeNodeState() {
    nodeState.k = 1;
    nodeState.x = initialValue;
    nodeState.decided = false;
  }

  // Fonction pour envoyer les propositions initiales à tous les nœuds
  async function sendInitialProposals() {
    for (let i = 0; i < N; i++) {
      await sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        k: nodeState.k,
        x: nodeState.x,
        messageType: "P"
      });
    }
  }

  // Fonction pour réinitialiser l'état du nœud s'il est défectueux
  function resetNodeState() {
    nodeState.decided = null;
    nodeState.x = null;
    nodeState.k = null;
  }

  // Fonction pour gérer les messages reçus par le nœud
  function handleMessage(message: any) {
    const { k, x, messageType } = message;
    if (messageType === "P") {
      handleProposalMessage(k, x);
    } else if (messageType === "V") {
      handleVoteMessage(k, x);
    }
  }

  // Fonction pour gérer les messages de proposition
  async function handleProposalMessage(k: number, x: Value) {
    if (!proposals.has(k)) proposals.set(k, []);
    proposals.get(k)!.push(x);

    if (proposals.get(k)!.length >= N - F) {
      await sendDecisionVotes(k);
    }
  }

  // Fonction pour gérer les messages de vote
  async function handleVoteMessage(k: number, x: Value) {
    if (!votes.has(k)) votes.set(k, []);
    votes.get(k)!.push(x);

    if (votes.get(k)!.length >= N - F) {
      await determineDecision(k);
    }
  }

  // Fonction pour envoyer les votes de décision
  async function sendDecisionVotes(k: number) {
    const countNo = proposals.get(k)!.filter((x) => x === 0).length;
    const countYes = proposals.get(k)!.filter((x) => x === 1).length;
    const decisionValue = countNo > N / 2 ? 0 : countYes > N / 2 ? 1 : "?";

    for (let i = 0; i < N; i++) {
      await sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        k,
        x: decisionValue,
        messageType: "V"
      });
    }
  }

  // Fonction pour déterminer la décision finale
  async function determineDecision(k: number) {
    const countNo = votes.get(k)!.filter((x) => x === 0).length;
    const countYes = votes.get(k)!.filter((x) => x === 1).length;

    if (countNo >= F + 1) {
      nodeState.x = 0;
      nodeState.decided = true;
    } else if (countYes >= F + 1) {
      nodeState.x = 1;
      nodeState.decided = true;
    } else {
      nodeState.x = countNo + countYes > 0 && countNo > countYes ? 0 :
                    countNo + countYes > 0 && countNo < countYes ? 1 :
                    Math.random() > 0.5 ? 0 : 1;

      if (nodeState.k !== null) nodeState.k += 1;
      await sendInitialProposals();
    }
  }

  // Fonction pour envoyer un message à un nœud distant
  async function sendMessage(url: string, data: any) {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
