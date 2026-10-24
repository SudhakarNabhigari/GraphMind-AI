import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { GraphNode, Relationship } from "@workspace/api-client-react";
import "@xyflow/react/dist/style.css";

type ConceptNodeData = {
  concept: GraphNode;
  example: boolean;
};
type ConceptFlowNode = Node<ConceptNodeData, "concept">;

const EXAMPLE_NODES: GraphNode[] = [
  { id: "sample-generative-ai", label: "Generative AI", description: null, category: "Concept", frequency: 12, documentIds: [], pages: [] },
  { id: "sample-deep-learning", label: "Deep Learning", description: null, category: "Method", frequency: 8, documentIds: [], pages: [] },
  { id: "sample-rag", label: "RAG", description: null, category: "Technology", frequency: 7, documentIds: [], pages: [] },
  { id: "sample-language-models", label: "Large Language Models", description: null, category: "Concept", frequency: 6, documentIds: [], pages: [] },
  { id: "sample-neural-networks", label: "Neural Networks", description: null, category: "Concept", frequency: 5, documentIds: [], pages: [] },
  { id: "sample-transformers", label: "Transformers", description: null, category: "Method", frequency: 4, documentIds: [], pages: [] },
  { id: "sample-prompting", label: "Prompt Engineering", description: null, category: "Method", frequency: 3, documentIds: [], pages: [] },
];

const EXAMPLE_EDGES: Edge[] = [
  { id: "sample-edge-1", source: "sample-generative-ai", target: "sample-deep-learning", label: "example link", type: "smoothstep" },
  { id: "sample-edge-2", source: "sample-generative-ai", target: "sample-rag", label: "example link", type: "smoothstep" },
  { id: "sample-edge-3", source: "sample-generative-ai", target: "sample-language-models", label: "example link", type: "smoothstep" },
  { id: "sample-edge-4", source: "sample-generative-ai", target: "sample-neural-networks", label: "example link", type: "smoothstep" },
  { id: "sample-edge-5", source: "sample-deep-learning", target: "sample-transformers", label: "example link", type: "smoothstep" },
  { id: "sample-edge-6", source: "sample-language-models", target: "sample-prompting", label: "example link", type: "smoothstep" },
];

function categoryClass(category: string) {
  const value = category.toLowerCase();
  if (value.includes("technology") || value.includes("tool")) return "category-2";
  if (value.includes("method") || value.includes("technique")) return "category-1";
  if (value.includes("topic") || value.includes("entity")) return "category-3";
  return "category-0";
}

function ConceptNodeView({ data, selected }: NodeProps<ConceptFlowNode>) {
  return (
    <div
      className={`graphflow-node ${categoryClass(data.concept.category)} ${selected ? "node-selected" : ""} ${data.example ? "node-example" : ""}`}
      role="group"
      aria-label={`${data.concept.label}, ${data.concept.frequency} mentions`}
      data-testid={`flow-node-${data.concept.id}`}
    >
      <Handle type="target" position={Position.Left} className="graphflow-handle" />
      <span className="graphflow-node-orb">
        <span />
      </span>
      <strong>{data.concept.label}</strong>
      <small>{data.example ? "illustration" : `${data.concept.frequency} mentions`}</small>
      <Handle type="source" position={Position.Right} className="graphflow-handle" />
    </div>
  );
}

const nodeTypes = { concept: ConceptNodeView };

function FlowCanvas({
  concepts,
  relationships,
  isExample,
  selectedNodeId,
  selectedEdgeId,
  onNodeClick,
  onEdgeClick,
}: {
  concepts: GraphNode[];
  relationships: Relationship[];
  isExample: boolean;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
}) {
  const example = isExample && concepts.length === 0;
  const dataNodes = example ? EXAMPLE_NODES : concepts;
  const initialNodes = useMemo<ConceptFlowNode[]>(
    () =>
      dataNodes.map((concept, index) => {
        const angle = (index / Math.max(dataNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const radiusX = dataNodes.length === 1 ? 0 : 310;
        const radiusY = dataNodes.length === 1 ? 0 : 178;
        return {
          id: concept.id,
          type: "concept",
          position: {
            x: 450 + Math.cos(angle) * radiusX,
            y: 275 + Math.sin(angle) * radiusY,
          },
          data: { concept, example },
          draggable: !example,
          selectable: !example,
          selected: concept.id === selectedNodeId,
        };
      }),
    [dataNodes, example, selectedNodeId],
  );
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes);
  const flowEdges = useMemo<Edge[]>(
    () =>
      (example ? EXAMPLE_EDGES : relationships)
        .filter((edge) => {
          const ids = new Set(dataNodes.map((node) => node.id));
          return ids.has(edge.source) && ids.has(edge.target);
        })
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: "smoothstep",
          label: example ? "example link" : edge.label,
          labelStyle: { fill: example ? "#8293ad" : "#8acfe0", fontSize: 8 },
          labelBgStyle: { fill: "#09162a", fillOpacity: 0.88 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          style: {
            stroke:
              edge.id === selectedEdgeId
                ? "#57b5ff"
                : example
                  ? "rgba(102, 123, 176, .38)"
                  : "rgba(63, 151, 226, .45)",
            strokeWidth: edge.id === selectedEdgeId ? 2 : 1.3,
          },
          animated: edge.id === selectedEdgeId,
          selectable: !example,
        })),
    [dataNodes, example, relationships, selectedEdgeId],
  );
  const { fitView } = useReactFlow();

  useEffect(() => {
    setFlowNodes(initialNodes);
  }, [initialNodes, setFlowNodes]);

  useEffect(() => {
    if (flowNodes.length) void fitView({ padding: 0.2, duration: 320 });
  }, [fitView, flowNodes.length]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => {
        if (!example) onNodeClick?.(node.id);
      }}
      onEdgeClick={(_, edge) => {
        if (!example) onEdgeClick?.(edge.id);
      }}
      nodesDraggable={!example}
      nodesConnectable={false}
      elementsSelectable={!example}
      panOnDrag
      zoomOnScroll
      minZoom={0.3}
      maxZoom={2}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      aria-label={example ? "Illustrative example graph" : "Interactive knowledge graph"}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#355077" />
      <Controls
        showInteractive={false}
        position="bottom-left"
        className="graphflow-controls"
      />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        maskColor="rgba(4, 11, 24, .64)"
        nodeColor={(node) =>
          node.selected ? "#9c85ff" : example ? "#536c9c" : "#4a9eed"
        }
        className="graphflow-minimap"
      />
    </ReactFlow>
  );
}

export function GraphFlow(props: {
  nodes: GraphNode[];
  edges: Relationship[];
  isExample?: boolean;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <FlowCanvas
        concepts={props.nodes}
        relationships={props.edges}
        isExample={props.isExample ?? false}
        selectedNodeId={props.selectedNodeId}
        selectedEdgeId={props.selectedEdgeId}
        onNodeClick={props.onNodeClick}
        onEdgeClick={props.onEdgeClick}
      />
    </ReactFlowProvider>
  );
}
