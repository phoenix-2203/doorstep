import { encodeAbiParameters, keccak256, getContractAddress, encodeFunctionData, stringToHex } from 'viem';
const C=[{name:'target',type:'address'},{name:'callData',type:'bytes'},{name:'amountOffset',type:'uint32'},{name:'refundTo',type:'address'},{name:'minAmount6',type:'uint256'},{name:'maxKeeperFee6',type:'uint256'},{name:'expiry',type:'uint64'},{name:'ref',type:'bytes32'}];
const intent={target:'0x2222222222222222222222222222222222222222',
 callData: encodeFunctionData({abi:[{type:'function',name:'deposit',inputs:[{type:'uint256'},{type:'address'}],outputs:[]}],functionName:'deposit',args:[0n,'0x3333333333333333333333333333333333333333']}),
 amountOffset:4, refundTo:'0x4444444444444444444444444444444444444444', minAmount6:50000n, maxKeeperFee6:10000n, expiry:1760140800n, ref: stringToHex('order-1',{size:32})};
const h=keccak256(encodeAbiParameters([{type:'tuple',components:C}],[intent]));
const lander=keccak256('0x608060405233fffe');
const addr=getContractAddress({opcode:'CREATE2',from:'0x1111111111111111111111111111111111111111',salt:h,bytecodeHash:lander});
console.log(JSON.stringify({hash:h,lander,addr,callData:intent.callData}));
