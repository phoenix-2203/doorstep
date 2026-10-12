// Generated from the compiled Doorstep contract (forge build). Do not edit by hand.
export const DOORSTEP_ABI = [
 {
  "type": "function",
  "name": "ALLOWANCE_REFUND",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "DELIVERY_GAS_ESTIMATE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "LANDER_CODE_HASH",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "NEW_ACCOUNT_GAS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "NO_AMOUNT",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "TAIL_GAS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "USDC",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "addressOf",
  "inputs": [
   {
    "name": "intent",
    "type": "tuple",
    "internalType": "struct Doorstep.Intent",
    "components": [
     {
      "name": "target",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "callData",
      "type": "bytes",
      "internalType": "bytes"
     },
     {
      "name": "amountOffset",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "refundTo",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "minAmount6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxKeeperFee6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "ref",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "announce",
  "inputs": [
   {
    "name": "intent",
    "type": "tuple",
    "internalType": "struct Doorstep.Intent",
    "components": [
     {
      "name": "target",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "callData",
      "type": "bytes",
      "internalType": "bytes"
     },
     {
      "name": "amountOffset",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "refundTo",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "minAmount6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxKeeperFee6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "ref",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "depositAddress",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "cancel",
  "inputs": [
   {
    "name": "intent",
    "type": "tuple",
    "internalType": "struct Doorstep.Intent",
    "components": [
     {
      "name": "target",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "callData",
      "type": "bytes",
      "internalType": "bytes"
     },
     {
      "name": "amountOffset",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "refundTo",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "minAmount6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxKeeperFee6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "ref",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "refunded",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "intentHash",
  "inputs": [
   {
    "name": "intent",
    "type": "tuple",
    "internalType": "struct Doorstep.Intent",
    "components": [
     {
      "name": "target",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "callData",
      "type": "bytes",
      "internalType": "bytes"
     },
     {
      "name": "amountOffset",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "refundTo",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "minAmount6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxKeeperFee6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "ref",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "pure"
 },
 {
  "type": "function",
  "name": "land",
  "inputs": [
   {
    "name": "intent",
    "type": "tuple",
    "internalType": "struct Doorstep.Intent",
    "components": [
     {
      "name": "target",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "callData",
      "type": "bytes",
      "internalType": "bytes"
     },
     {
      "name": "amountOffset",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "refundTo",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "minAmount6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxKeeperFee6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "ref",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "landed",
    "type": "bool",
    "internalType": "bool"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "pending",
  "inputs": [
   {
    "name": "intent",
    "type": "tuple",
    "internalType": "struct Doorstep.Intent",
    "components": [
     {
      "name": "target",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "callData",
      "type": "bytes",
      "internalType": "bytes"
     },
     {
      "name": "amountOffset",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "refundTo",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "minAmount6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxKeeperFee6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "ref",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "event",
  "name": "Announced",
  "inputs": [
   {
    "name": "intentHash",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "depositAddress",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "intent",
    "type": "tuple",
    "indexed": false,
    "internalType": "struct Doorstep.Intent",
    "components": [
     {
      "name": "target",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "callData",
      "type": "bytes",
      "internalType": "bytes"
     },
     {
      "name": "amountOffset",
      "type": "uint32",
      "internalType": "uint32"
     },
     {
      "name": "refundTo",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "minAmount6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "maxKeeperFee6",
      "type": "uint256",
      "internalType": "uint256"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "ref",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Bounced",
  "inputs": [
   {
    "name": "intentHash",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "ref",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "refundTo",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "depositAddress",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   },
   {
    "name": "reason",
    "type": "uint8",
    "indexed": false,
    "internalType": "enum Doorstep.BounceReason"
   },
   {
    "name": "refunded",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "keeperFee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "revertData",
    "type": "bytes",
    "indexed": false,
    "internalType": "bytes"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Landed",
  "inputs": [
   {
    "name": "intentHash",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "ref",
    "type": "bytes32",
    "indexed": true,
    "internalType": "bytes32"
   },
   {
    "name": "target",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "depositAddress",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   },
   {
    "name": "amountPulled6",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "refunded",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "keeperFee",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "BelowMinimum",
  "inputs": [
   {
    "name": "arrived6",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "minAmount6",
    "type": "uint256",
    "internalType": "uint256"
   }
  ]
 },
 {
  "type": "error",
  "name": "InsufficientGas",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidIntent",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NativeTransferFailed",
  "inputs": [
   {
    "name": "to",
    "type": "address",
    "internalType": "address"
   }
  ]
 },
 {
  "type": "error",
  "name": "NotRefundTo",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NothingToLand",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Reentrancy",
  "inputs": []
 }
];
