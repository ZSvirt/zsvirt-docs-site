#!/usr/bin/env python3
"""Translate EN terraform-for-zsphere reference MDX files to ZH."""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

EN_ROOT = Path(__file__).resolve().parents[1] / "content/docs/en/terraform-for-zsvirt"
ZH_ROOT = Path(__file__).resolve().parents[1] / "content/docs/zh/terraform-for-zsvirt"
PROVIDER_SOURCE_MARKER = re.compile(
    r"\{/\*\s*terraform-source-sha256:\s*([0-9a-f]{64})\s*\*/\}"
)


def display_zh_path(path: Path) -> Path:
    try:
        return path.relative_to(ZH_ROOT)
    except ValueError:
        return path


DESCRIPTIONS: dict[str, str] = {
    "cluster": "管理 ZSphere 集群。集群是共享相同 Hypervisor 类型与存储的逻辑主机集合，提供资源隔离，是 ZSphere 资源管理的基本单元。",
    "datacenter": "管理 ZSphere 数据中心（区域）。数据中心是顶层资源容器，用于组织集群、存储与网络资源。",
    "host": "管理 ZSphere 物理主机。主机是运行虚拟机的计算节点，需归属于某个集群。",
    "distributed_switch": "管理 ZSphere 分布式交换机（vSwitch），用于承载端口组等二层网络资源。",
    "port_group": "管理 ZSphere 端口组，用于定义虚拟机网络、VLAN 与 IP 地址管理（IPAM）等配置。",
    "local_primary_storage": "管理 ZSphere 本地主存储，用于存放云主机磁盘数据。",
    "nfs_primary_storage": "管理 ZSphere NFS 主存储，通过 NFS 协议提供共享存储。",
    "image_storage": "管理 ZSphere 镜像存储，用于存放云主机镜像文件。",
    "image": "管理 ZSphere 镜像。镜像可为 qcow2、raw、vmdk 等格式或 ISO 文件，用于创建或启动云主机。",
    "vm_template": "管理 ZSphere 云主机模板。模板由已有云主机实例转换而来。",
    "instance": "管理 ZSphere 云主机（VM）实例，可配置 CPU、内存、磁盘、网卡等属性。",
    "security_group": "管理 ZSphere 安全组及其访问规则。",
    "tag": "管理 ZSphere 资源标签，用于分类与检索资源。",
    "clusters": "查询 ZSphere 集群列表及其属性。",
    "datacenters": "查询 ZSphere 数据中心列表及其属性。",
    "hosts": "查询 ZSphere 物理主机列表及其属性。",
    "distributed_switches": "查询 ZSphere 分布式交换机列表及其属性。",
    "port_groups": "查询 ZSphere 端口组列表及其属性。",
    "local_primary_storages": "查询 ZSphere 本地主存储列表及其属性。",
    "nfs_primary_storages": "查询 ZSphere NFS 主存储列表及其属性。",
    "image_storages": "查询 ZSphere 镜像存储列表及其属性。",
    "images": "查询 ZSphere 镜像列表及其属性。",
    "vm_templates": "查询 ZSphere 云主机模板列表及其属性。",
    "instances": "查询 ZSphere 云主机实例列表及其属性。",
    "security_groups": "查询 ZSphere 安全组列表及其属性。",
    "tags": "查询 ZSphere 标签列表及其属性。",
}

TYPE_MAP = {
    "String": "字符串",
    "Boolean": "布尔值",
    "Number": "数字",
    "List of String": "字符串列表",
    "Block List": "块列表",
    "Attributes List": "属性列表",
    "Set of String": "字符串集合",
    "Map of String": "字符串映射",
}

POST_REGEX: list[tuple[str, str]] = [
    (r"Exact name for searching[^\n]*", "按精确名称查询"),
    (r"Exact name for Searching[^\n]*", "按精确名称查询"),
    (
        r"Pattern for fuzzy name search, similar to MySQL LIKE\. Use % for multiple characters and _ for exactly one character\.",
        "按名称模糊查询，类似 MySQL LIKE。`%` 匹配多个字符，`_` 匹配单个字符",
    ),
    (
        r"Name of the field to filter by \(e\.g\., [^)]+\)\.",
        "用于过滤的字段名。",
    ),
    (
        r"Values to filter by\. Multiple values will be treated as an OR condition\.",
        "过滤值，多个值之间为 OR 关系。",
    ),
    (r"List of tags matching the specified filters ", "符合过滤条件的标签列表"),
    (r"List of security groups matching the specified filters\.", "符合过滤条件的安全组列表。"),
    (r"List of L3 networks matching the specified filters\.", "符合过滤条件的三层网络列表。"),
    (r"List of NFS primary storage entries ", "NFS 主存储条目列表"),
    (r"List of local primary storage entries ", "本地主存储条目列表"),
    (r"List of DNS servers for the L3 network\.", "三层网络 DNS 服务器列表。"),
    (r"List of free IPs available in the L3 network\.", "三层网络可用空闲 IP 列表。"),
    (r"List of IP ranges in the L3 network\.", "三层网络 IP 地址段列表。"),
    (r"Security group rules\.", "安全组规则。"),
    (r"The UUID of the account that owns the VM template\.", "拥有该云主机模板的账号 UUID。"),
    (r"The unique identifier \(UUID\) of the VM template\.", "云主机模板唯一标识符（UUID）。"),
    (r"The UUID of the zone in which the VM template is located\.", "云主机模板所在区域 UUID。"),
    (r"Color of the tag in hex format", "标签颜色（十六进制）"),
    (r"Description of the tag", "标签描述"),
    (r"Name of the tag", "标签名称"),
    (r"Type of the tag", "标签类型"),
    (r"UUID identifier of the tag", "标签 UUID"),
    (r"Value of the tag", "标签值"),
    (r"Rule action: ACCEPT or DROP\.", "规则动作：ACCEPT 或 DROP。"),
    (r"Allowed CIDR block\.", "允许的 CIDR 网段。"),
    (r"Description of the rule\.", "规则描述。"),
    (r"Destination IP range\.", "目标 IP 范围。"),
    (r"Destination port range\.", "目标端口范围。"),
    (r"Rule priority\.", "规则优先级。"),
    (r"Protocol: TCP, UDP, ICMP, or ALL\.", "协议：TCP、UDP、ICMP 或 ALL。"),
    (r"Remote security group UUID\.", "远端安全组 UUID。"),
    (r"Source IP range\.", "源 IP 范围。"),
    (r"Rule state: Enabled or Disabled\.", "规则状态：Enabled 或 Disabled。"),
    (r"Rule type: Ingress or Egress\.", "规则类型：Ingress 或 Egress。"),
    (r"UUIDs of L3 networks that the security group is attached to\.", "安全组绑定的三层网络 UUID 列表。"),
    (r"Description of the security group\.", "安全组描述。"),
    (r"Name of the security group\.", "安全组名称。"),
    (r"State of the security group\.", "安全组状态。"),
    (r"UUID of the security group\.", "安全组 UUID。"),
    (r"UUIDs of VM nics bound to the security group\.", "绑定到安全组的云主机网卡 UUID 列表。"),
    (r"Category of the L3 network\.", "三层网络类别。"),
    (r"Name of the L3 network", "三层网络名称"),
    (r"UUID of the L3 network\.", "三层网络 UUID。"),
    (r"DNS server address\.", "DNS 服务器地址。"),
    (r"Gateway for the free IP\.", "空闲 IP 的网关。"),
    (r"Free IP address\.", "空闲 IP 地址。"),
    (r"UUID of the IP range containing the free IP\.", "包含该空闲 IP 的地址段 UUID。"),
    (r"Netmask for the free IP\.", "空闲 IP 的子网掩码。"),
    (r"CIDR notation for the IP range\.", "IP 地址段的 CIDR 表示。"),
    (r"Ending IP address in the range\.", "IP 地址段结束地址。"),
    (r"Gateway for the IP range\.", "IP 地址段网关。"),
    (r"Netmask of the IP range\.", "IP 地址段子网掩码。"),
    (r"Starting IP address in the range\.", "IP 地址段起始地址。"),
    (r"Available capacity of the ([^ ]+) in bytes", r"\1可用容量（字节）"),
    (r"Available physical capacity of the ([^ ]+) in bytes", r"\1可用物理容量（字节）"),
    (r"Datacenter UUID of the ([^ ]+)", r"\1所属数据中心 UUID"),
    (r"Mount path of the ([^ ]+)", r"\1挂载路径"),
    (r"Name of the ([^ ]+)", r"\1名称"),
    (r"State of the ([^ ]+) \(Enabled or Disabled\)", r"\1状态（Enabled 或 Disabled）"),
    (r"Readiness status of the ([^ ]+)", r"\1就绪状态"),
    (r"System used capacity of the ([^ ]+) in bytes", r"\1系统占用容量（字节）"),
    (r"Total capacity of the ([^ ]+) in bytes", r"\1总容量（字节）"),
    (r"Total physical capacity of the ([^ ]+) in bytes", r"\1总物理容量（字节）"),
    (r"Type of the ([^ ]+)", r"\1类型"),
    (r"URL of the ([^ ]+)", r"\1 URL"),
    (r"UUID identifier of the ([^ ]+)", r"\1 UUID"),
    (r"The CPU architecture \(e\.g\., x86_64, ARM\) of the VM\.", "云主机 CPU 架构（如 x86_64、ARM）。"),
    (r"The UUID of the cluster in which the VM is located\.", "云主机所在集群 UUID。"),
    (r"The number of CPUs allocated to the VM\.", "分配给云主机的 CPU 数量。"),
    (r"The UUID of the zone in which the VM is located\.", "云主机所在区域 UUID。"),
    (r"The UUID of the host on which the VM is running\.", "运行云主机的物理主机 UUID。"),
    (r"The type of hypervisor on which the VM is running \(e\.g\., KVM, VMware\)\.", "云主机 Hypervisor 类型（如 KVM、VMware）。"),
    (r"The UUID of the image used to create the VM\.", "创建云主机所用镜像 UUID。"),
    (r"The amount of memory allocated to the VM, in megabytes \(MB\)\.", "分配给云主机的内存大小（MB）。"),
    (r"The name of the VM instance\.", "云主机实例名称。"),
    (r"The platform \(e\.g\., Linux, Windows\) on which the VM is running\.", "云主机平台类型（如 Linux、Windows）。"),
    (r"The current state of the VM \(e\.g\., Running, Stopped\)\.", "云主机当前状态（如 Running、Stopped）。"),
    (r"The type of the VM \(e\.g\., UserVm or SystemVm\)\.", "云主机类型（如 UserVm、SystemVm）。"),
    (r"The unique identifier \(UUID\) of the VM instance\.", "云主机实例唯一标识符（UUID）。"),
    (r"The actual size of the volume, which might differ from the requested size, in gigabytes \(GB\)\.", "磁盘实际大小（GB），可能与申请大小不同。"),
    (r"The description of the volume attached to the VM\.", "云主机挂载磁盘的描述。"),
    (r"The format of the volume \(e\.g\., RAW, QCOW2\)\.", "磁盘格式（如 RAW、QCOW2）。"),
    (r"The size of the volume in gigabytes \(GB\)\.", "磁盘大小（GB）。"),
    (r"The state of the volume \(e\.g\., Enabled, Disabled\)\.", "磁盘状态（如 Enabled、Disabled）。"),
    (r"The status of the volume \(e\.g\., Ready, NotReady\)\.", "磁盘就绪状态（如 Ready、NotReady）。"),
    (r"The type of the volume \(e\.g\., Root, Data\)\.", "磁盘类型（如 Root、Data）。"),
    (r"The UUID of the volume attached to the VM\.", "云主机挂载磁盘的 UUID。"),
    (r"The IP address assigned to the VM NIC\.", "云主机网卡分配的 IP 地址。"),
    (r"The UUID of the datacenter \(zone\) to which the distributed switch belongs\.", "分布式交换机所属数据中心（区域）UUID。"),
    (r"The UUID of the distributed switch\.", "分布式交换机 UUID。"),
    (r"The UUID of the cluster to which the VM template belongs\.", "云主机模板所属集群 UUID。"),
    (r"The UUID of the NFS primary storage", "NFS 主存储 UUID"),
    (r"The UUID of the local primary storage", "本地主存储 UUID"),
    (r"The UUID of the cluster where the VM instance is deployed\.", "云主机实例所在集群 UUID。"),
    (r"The UUID of the zone where the VM instance is deployed\.", "云主机实例所在区域 UUID。"),
    (r"The UUID of the host where the VM instance is running\.", "运行云主机实例的物理主机 UUID。"),
    (
        r"The UUID of the image used to create the VM instance\. Either image_uuid or template_uuid must be specified\.",
        "创建云主机实例所用镜像 UUID。`image_uuid` 与 `template_uuid` 须指定其一。",
    ),
    (
        r"The UUID of the templated VM instance to create the VM from\. Either image_uuid or template_uuid must be specified\.",
        "用于创建云主机的模板实例 UUID。`image_uuid` 与 `template_uuid` 须指定其一。",
    ),
    (r"MAC address of the VM NIC\.", "云主机网卡 MAC 地址。"),
    (r"UUID of the L3 network to which the NIC is connected\.", "网卡连接的三层网络 UUID。"),
    (r"UUID of the VM NIC\.", "云主机网卡 UUID。"),
    (r"Description of the distributed switch\.", "分布式交换机描述。"),
    (r"Description of the NFS primary storage", "NFS 主存储描述"),
    (r"Description of the local primary storage", "本地主存储描述"),
    (r"Description of the Image Storage", "镜像存储描述"),
    (r"The UUID of the primary storage for the data disk\.", "数据盘所在主存储 UUID。"),
    (r"The UUID of the L3 network for this NIC\.", "网卡所属三层网络 UUID。"),
    (r"The UUID of the primary storage for the root disk\.", "根盘所在主存储 UUID。"),
    (r"The IP address assigned to the network\.", "网络分配的 IP 地址。"),
    (r"The UUID of the network\.", "网络 UUID。"),
    (r"The UUID of the cluster to which the host belongs\.", "物理主机所属集群 UUID。"),
    (r"The SSH port for connecting to the host\. Default is 22\.", "连接物理主机的 SSH 端口，默认 22。"),
    (r"The CPU architecture of the host\.", "物理主机 CPU 架构。"),
    (r"The UUID of the zone to which the host belongs\.", "物理主机所属区域 UUID。"),
    (r"The UUID of the cluster to attach\.", "要挂载的集群 UUID。"),
    (r"The UUID of the host\.", "物理主机 UUID。"),
    (r" （资源）", "（资源）"),
    (r" （数据源）", "（数据源）"),
    (r"（参见下方嵌套结构\([^)]+\)）", "（参见下方嵌套结构）"),
    (r"\(参见下方嵌套结构\([^)]+\)\)", "（参见下方嵌套结构）"),
]

SECTION_MAP = {
    "## Example Usage": "## 示例用法",
    "## Schema": "## 参数说明",
    "### Required": "### 必填参数",
    "### Optional": "### 可选参数",
    "### Read-Only": "### 只读属性",
    "Required:": "必填参数：",
    "Optional:": "可选参数：",
    "Read-Only:": "只读属性：",
}

PHRASES: list[tuple[str, str]] = [
    ("Changing this will force recreation of the resource.", "修改此参数将强制重建资源。"),
    ("Changing this will recreate the resource.", "修改此参数将重建资源。"),
    ("Automatically generated by ZSphere.", "由 ZSphere 自动生成。"),
    ("Set automatically by ZStack.", "由 ZStack 自动设置。"),
    ("This is a mandatory field.", "必填项。"),
    (
        "Required if using AccessKey authentication.",
        "使用 AccessKey 认证时必填。",
    ),
    (
        "Required if using Account authentication.",
        "使用账号认证时必填。",
    ),
    (
        "Using `access_key_id` and `access_key_secret` is the recommended approach for authentication, as it provides more flexibility and security.",
        "推荐使用 AccessKey 认证，灵活性和安全性更好。",
    ),
    ("May also be provided via", "也可通过环境变量"),
    (" environment variable.", " 设置。"),
    ("Mutually exclusive with", "与以下参数互斥："),
    ("see [below for nested schema]", "参见下方嵌套结构"),
    ("(see [below for nested schema]", "（参见下方嵌套结构"),
    ("Valid values are:", "可选值："),
    ("Valid values:", "可选值："),
    ("Examples include", "例如"),
    ("Indicates if the image should be expunged (permanently deleted) after deletion. If true, the image will be expunged instead of just deleted.", "删除后是否彻底销毁（expunge）镜像。设为 true 时彻底删除，而非仅标记删除。"),
    ("Indicates if the VirtIO drivers are required for the image.", "镜像是否需要 VirtIO 驱动。"),
    ("Indicates if the image is a system image.", "是否为系统镜像。"),
    ("Enable or disable the image. When set to true, the image will be enabled.", "启用或禁用镜像。设为 true 时启用。"),
    ("Enable Dynamic Resource Scheduling (DRS).", "启用动态资源调度（DRS）。"),
    ("Enable network HP (ovsdpdk).", "启用网络高性能模式（ovsdpdk）。"),
    ("Whether DHCP service is enabled for the port group.", "端口组是否启用 DHCP 服务。"),
    ("Whether IPAM is enabled for the port group.", "端口组是否启用 IP 地址管理（IPAM）。"),
    ("Whether to use CIDR notation instead of IP range.", "是否使用 CIDR 表示法而非 IP 段。"),
    ("Fetches a list of tags and their associated attributes.", "查询标签列表及其属性。"),
    ("Fetches a list of security groups and their associated attributes.", "查询安全组列表及其属性。"),
    ("Fetches a list of clusters and their associated attributes.", "查询集群列表及其属性。"),
    ("Fetches a list of datacenters and their associated attributes.", "查询数据中心列表及其属性。"),
    ("Fetches a list of hosts and their associated attributes.", "查询物理主机列表及其属性。"),
    ("Fetches a list of distributed switches and their associated attributes.", "查询分布式交换机列表及其属性。"),
    ("Fetches a list of port groups and their associated attributes.", "查询端口组列表及其属性。"),
    ("Fetches a list of local primary storages and their associated attributes.", "查询本地主存储列表及其属性。"),
    ("Fetches a list of NFS primary storages and their associated attributes.", "查询 NFS 主存储列表及其属性。"),
    ("Fetches a list of image storages and their associated attributes.", "查询镜像存储列表及其属性。"),
    ("Fetches a list of images and their associated attributes.", "查询镜像列表及其属性。"),
    ("Fetches a list of VM templates and their associated attributes.", "查询云主机模板列表及其属性。"),
    ("Fetches a list of VM instances and their associated attributes.", "查询云主机实例列表及其属性。"),
    ("Resource definition for ZSphere Port Group.", "ZSphere 端口组资源定义。"),
    ("Search by name pattern", "按名称模式查询"),
    ("Search by name", "按名称查询"),
    ("Filter results", "过滤查询结果"),
    ("# example output:", "# 示例输出："),
    ("# Example output:", "# 示例输出："),
    ("# example out:", "# 示例输出："),
    ("# Note: Creating a VM Template is done by converting an existing VM instance.", "# 说明：云主机模板通过将已有云主机实例转换而来。"),
    ("# This resource is used to manage existing VM templates (read, update, delete).", "# 本资源用于管理已有模板（读取、更新、删除）。"),
    ("# The creation of VM templates needs to be done through:", "# 创建模板需通过以下方式："),
    ("# 1. Converting an existing VM instance using ZStack UI", "# 1. 在 ZStack 控制台将已有云主机转换为模板"),
    ("# 2. Using API: POST /vm-instances/{uuid}/create-templated-vmInstance", "# 2. 调用 API：POST /vm-instances/{uuid}/create-templated-vmInstance"),
    ("# 3. Or using zsphere_instance resource with convert_to_template = true", "# 3. 或使用 zsphere_instance 资源的 convert_to_template = true"),
    ("The unique identifier of the", "唯一标识符，由 ZSphere 管理。"),
    ("The unique identifier of", "唯一标识符。"),
    ("References to the backup storages where this image is stored.", "镜像所在备份存储的引用信息。"),
    ("The install path of the image on the backup storage.", "镜像在备份存储上的安装路径。"),
    ("The UUID of the backup storage.", "备份存储 UUID。"),
    ("A list of UUIDs for the image storages where the image is stored.", "镜像所在镜像存储的 UUID 列表。"),
    ("The URL where the image is located. This can be a file path or an HTTP link.", "镜像所在 URL，可为文件路径或 HTTP 链接。"),
    ("The architecture of the image, such as 'x86_64' or 'aarch64'.", "镜像架构，如 x86_64、aarch64。"),
    ("The boot mode supported by the image, such as 'Legacy', 'UEFI', or 'UEFI_WITH_CSM'.", "镜像支持的启动模式，如 Legacy、UEFI、UEFI_WITH_CSM。"),
    ("A description of the image, providing additional context or details.", "镜像描述信息。"),
    ("The format of the image file, such as 'qcow2', 'raw', or 'vmdk'.", "镜像文件格式，如 qcow2、raw、vmdk。"),
    ("The guest operating system type that the image is optimized for.", "镜像优化的来宾操作系统类型。"),
    ("The type of media for the image.", "镜像介质类型。"),
    ("The platform that the image is intended for, such as 'Linux', 'Windows', or others.", "镜像目标平台，如 Linux、Windows 等。"),
    ("The actual size of the image in bytes after compression.", "压缩后镜像实际大小（字节）。"),
    ("The MD5 checksum of the image.", "镜像 MD5 校验和。"),
    ("The size of the image in bytes.", "镜像大小（字节）。"),
    ("The state of the image, such as 'Enabled' or 'Disabled'.", "镜像状态，如 Enabled、Disabled。"),
    ("The status of the image, such as 'Ready' or 'NotReady'.", "镜像就绪状态，如 Ready、NotReady。"),
    ("The type of the image, such as 'zstack' or 'iso'.", "镜像类型，如 zstack、iso。"),
    ("The name of the image.", "镜像名称。"),
    ("The name of the cluster.", "集群名称。"),
    ("The name of the VM template.", "云主机模板名称。"),
    ("The description of the VM template.", "云主机模板描述。"),
    ("The UUID of the VM instance to convert to a template.", "要转换为模板的云主机实例 UUID。"),
    ("The UUID of the datacenter (zone) to which the cluster belongs.", "集群所属数据中心（区域）UUID。"),
    ("The hypervisor type of the cluster.", "集群 Hypervisor 类型。"),
    ("The CPU architecture of the cluster.", "集群 CPU 架构。"),
    ("Automation level for DRS.", "DRS 自动化级别。"),
    ("CPU model validation.", "CPU 型号校验。"),
    ("CPU mode.", "CPU 模式。"),
    ("CPU over-provisioning ratio.", "CPU 超分比。"),
    ("A description of the cluster, providing additional context or details.", "集群描述信息。"),
    ("Display network CIDR.", "展示网络 CIDR。"),
    ("DRS CPU threshold percentage.", "DRS CPU 阈值百分比。"),
    ("DRS threshold duration in seconds.", "DRS 阈值持续时间（秒）。"),
    ("DRS memory threshold percentage.", "DRS 内存阈值百分比。"),
    ("Migration network CIDR.", "迁移网络 CIDR。"),
    ("The type of the cluster.", "集群类型。"),
    ("VM HA level.", "云主机 HA 级别。"),
    ("The state of the cluster, such as 'Enabled' or 'Disabled'.", "集群状态，如 Enabled、Disabled。"),
    ("Name of the port group.", "端口组名称。"),
    ("VLAN ID for the port group.", "端口组 VLAN ID。"),
    ("UUID of the vSwitch that this port group is attached to.", "端口组所连接的 vSwitch UUID。"),
    ("Category of the port group.", "端口组类别。"),
    ("Description of the port group.", "端口组描述。"),
    ("DHCP service IP address.", "DHCP 服务 IP 地址。"),
    ("DNS servers for the port group.", "端口组 DNS 服务器列表。"),
    ("DNS domain for the port group.", "端口组 DNS 域名。"),
    ("IP version (4 or 6).", "IP 版本（4 或 6）。"),
    ("Type of the port group.", "端口组类型。"),
    ("VLAN mode for the port group.", "端口组 VLAN 模式。"),
    ("UUID of the datacenter (zone) that this port group belongs to.", "端口组所属数据中心 UUID。"),
    ("State of the port group.", "端口组状态。"),
    ("UUID of the port group.", "端口组 UUID。"),
    ("IP range configuration for the port group.", "端口组 IP 地址段配置。"),
    ("Name of the IP range.", "IP 地址段名称。"),
    ("IPv6 address mode: Stateful-DHCP, Stateless-DHCP, or SLAAC.", "IPv6 地址模式：Stateful-DHCP、Stateless-DHCP 或 SLAAC。"),
    ("End IP address of the range (IP range mode).", "IP 段结束地址（IP 段模式）。"),
    ("Gateway address.", "网关地址。"),
    ("IP allocation strategy: RandomIpAllocator, FirstAvailableIpAllocator, AscDelayRecycleIpAllocator.", "IP 分配策略。"),
    ("Netmask (IP range mode).", "子网掩码（IP 段模式）。"),
    ("Network CIDR (CIDR mode).", "网络 CIDR（CIDR 模式）。"),
    ("Prefix length for IPv6 CIDR.", "IPv6 CIDR 前缀长度。"),
    ("Start IP address of the range (IP range mode).", "IP 段起始地址（IP 段模式）。"),
    ("UUID of the IP range.", "IP 地址段 UUID。"),
    ("such as", "如"),
    ("Indicates if", "是否"),
    ("Indicates whether", "是否"),
    ("When set to true,", "设为 true 时，"),
    ("Example:", "示例："),
]


def parse_frontmatter(content: str) -> tuple[dict[str, str], str]:
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n([\s\S]*)$", content, re.DOTALL)
    if not match:
        return {}, content
    fm_raw, body = match.group(1), match.group(2)
    fm: dict[str, str] = {}
    title_match = re.search(r"title:\s*['\"](.*?)['\"]", fm_raw, re.DOTALL)
    desc_match = re.search(r"description:\s*['\"](.*?)['\"]", fm_raw, re.DOTALL)
    if title_match:
        fm["title"] = title_match.group(1).replace("''", "'")
    if desc_match:
        fm["description"] = desc_match.group(1).replace("''", "'")
    return fm, body


def build_frontmatter(title: str, description: str) -> str:
    title = title.replace("'", "''")
    description = description.replace("'", "''")
    return f"---\ntitle: '{title}'\ndescription: '{description}'\n---\n\n"


def translate_type(type_str: str) -> str:
    if ", Sensitive" in type_str:
        base = type_str.replace(", Sensitive", "")
        mapped = TYPE_MAP.get(base, base)
        return f"{mapped}，敏感"
    return TYPE_MAP.get(type_str, type_str)


def post_process(text: str) -> str:
    text = re.sub(
        r"Filter resources based on any field in the schema\. For example,.*?(?:\(参见下方嵌套结构\([^)]+\)\)|（参见下方嵌套结构）)",
        "按 schema 中任意字段过滤资源。（参见下方嵌套结构）",
        text,
    )
    for pattern, repl in POST_REGEX:
        text = re.sub(pattern, repl, text)
    return text


def apply_phrases(text: str) -> str:
    for en, zh in PHRASES:
        text = text.replace(en, zh)
    return post_process(text)


def translate_line(line: str) -> str:
    if line in SECTION_MAP:
        return SECTION_MAP[line]

    nested = re.match(r"^### Nested Schema for `(.+)`$", line)
    if nested:
        return f"### `{nested.group(1)}` 嵌套结构"

    line = line.replace("(Resource)", "（资源）").replace("(Data Source)", "（数据源）")

    bullet = re.match(r"^(- `[^`]+` )(\([^)]+\))( .+)$", line)
    if bullet:
        prefix, typ, desc = bullet.groups()
        typ_inner = typ[1:-1]
        typ_zh = translate_type(typ_inner)
        desc_zh = apply_phrases(desc.strip())
        link_match = re.search(r"（参见下方嵌套结构[^）]*）", desc_zh)
        if link_match:
            desc_zh = "（参见下方嵌套结构）"
        return f"{prefix.rstrip()}（{typ_zh}）{desc_zh.lstrip()}" if desc_zh else f"{prefix.rstrip()}（{typ_zh}）"

    return apply_phrases(line)


def translate_prose(text: str, stem: str) -> str:
    intro = DESCRIPTIONS.get(stem)
    lines = text.splitlines()
    out: list[str] = []
    seen_h1 = False
    replaced_intro = False

    for line in lines:
        if line.startswith("# zsphere_"):
            seen_h1 = True
            out.append(
                line.replace("(Resource)", "（资源）").replace("(Data Source)", "（数据源）")
                .replace(" （资源）", "（资源）").replace(" （数据源）", "（数据源）")
            )
            continue

        if (
            seen_h1
            and not replaced_intro
            and intro
            and line.strip()
            and not line.startswith("#")
            and not line.startswith("```")
            and not line.startswith("##")
            and not line.startswith("<")
            and not line.startswith("-")
        ):
            out.append(intro)
            replaced_intro = True
            continue

        if line.startswith("```"):
            out.append(line)
            continue

        out.append(translate_line(line))

    return "\n".join(out).rstrip() + "\n"


def split_code_fences(text: str) -> list[tuple[bool, str]]:
    parts = re.split(r"(```[\s\S]*?```)", text)
    result: list[tuple[bool, str]] = []
    for index, part in enumerate(parts):
        result.append((index % 2 == 1, part))
    return result


def translate_body(body: str, stem: str) -> str:
    chunks: list[str] = []
    for is_code, part in split_code_fences(body):
        if is_code:
            chunks.append(apply_phrases(part))
        else:
            chunks.append(translate_prose(part, stem))
    text = "".join(chunks)
    text = text.replace("/en/docs/terraform-for-zsphere", "/docs/terraform-for-zsphere")
    return text


def translate_file(en_path: Path, zh_path: Path, *, check: bool) -> bool:
    content = en_path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(content)
    stem = en_path.stem
    title = fm.get("title", stem)
    description = DESCRIPTIONS.get(stem, fm.get("description", ""))
    zh_body = translate_body(body, stem)
    expected = build_frontmatter(title, description) + zh_body
    current = zh_path.read_text(encoding="utf-8") if zh_path.exists() else None
    if current == expected:
        return False
    if check:
        print(f"outdated: {display_zh_path(zh_path)}")
        return True
    zh_path.parent.mkdir(parents=True, exist_ok=True)
    zh_path.write_text(expected, encoding="utf-8")
    print(f"updated: {display_zh_path(zh_path)}")
    return True


def translate_directory(en_dir: Path, zh_dir: Path, *, check: bool) -> int:
    en_files = sorted(
        path for path in en_dir.glob("*.mdx") if path.name != "index.mdx"
    )
    expected_targets = {zh_dir / path.name for path in en_files}
    changed = 0
    for en_file in en_files:
        changed += translate_file(
            en_file,
            zh_dir / en_file.name,
            check=check,
        )
    for zh_path in sorted(zh_dir.glob("*.mdx")):
        if zh_path.name == "index.mdx" or zh_path in expected_targets:
            continue
        changed += 1
        relative_path = display_zh_path(zh_path)
        if check:
            print(f"orphaned: {relative_path}")
            continue
        zh_path.unlink()
        print(f"removed: {relative_path}")
    return changed


def provider_translation_is_outdated(en_path: Path, zh_path: Path) -> bool:
    en_digest = hashlib.sha256(en_path.read_bytes()).hexdigest()
    if not zh_path.exists():
        print(f"outdated: {display_zh_path(zh_path)} (manual translation missing)")
        return True
    marker = PROVIDER_SOURCE_MARKER.search(zh_path.read_text(encoding="utf-8"))
    if marker and marker.group(1) == en_digest:
        return False
    print(
        f"outdated: {display_zh_path(zh_path)} "
        "(English provider source changed; review the manual translation and update its source digest)"
    )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Report generated files that differ without writing them.",
    )
    args = parser.parse_args()

    provider_outdated = provider_translation_is_outdated(
        EN_ROOT / "provider-configuration.mdx",
        ZH_ROOT / "provider-configuration.mdx",
    )
    changed = 0
    for sub in ("resources", "data-sources"):
        changed += translate_directory(
            EN_ROOT / sub,
            ZH_ROOT / sub,
            check=args.check,
        )
    action = "outdated" if args.check else "updated"
    print(f"{action}: {changed} file(s)")
    return 1 if provider_outdated or (args.check and changed) else 0


if __name__ == "__main__":
    sys.exit(main())
